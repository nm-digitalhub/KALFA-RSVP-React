import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/data/admin/access-log', () => ({ recordStaffAccess: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/event-exchange-sync', () => ({
  rescheduleEventExchangeAppointment: vi.fn(),
  syncEventToExchange: vi.fn(),
}));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import {
  rescheduleEventExchangeAppointment,
  syncEventToExchange,
} from '@/lib/data/event-exchange-sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { rescheduleEventForAdmin } from './events';

const EVENT = {
  id: 'e1',
  owner_id: 'owner-1',
  event_date: '2026-12-10T18:00:00+00:00',
  status: 'active',
};

/** The service-role client: reads the event row and reads it back afterwards. */
function mockAdminClient(rows: unknown[] = [EVENT, { event_date: null, rsvp_deadline: null }]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'maybeSingle']) {
    builder[m] = vi.fn(() => builder);
  }
  (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
    onFulfilled({ data: rows[Math.min(call++, rows.length - 1)], error: null });
  const client = { from: vi.fn(() => builder) };
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return client;
}

/** The user-scoped client: the ONLY one that may carry the RPC. */
function mockCookieClient(rpcResult: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => rpcResult);
  vi.mocked(createClient).mockResolvedValue(
    { rpc } as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'staff-1' } as unknown as User);
});

describe('rescheduleEventForAdmin', () => {
  it('demands a real reason before reading anything about the customer', async () => {
    mockAdminClient();
    const rpc = mockCookieClient({ data: '2027-01-01T18:00:00+00:00', error: null });

    await expect(
      rescheduleEventForAdmin('e1', '2027-01-01T18:00:00+00:00', 'קצר'),
    ).rejects.toThrow('יש לפרט את הסיבה');

    // Neither the row nor the write may happen on the way to that refusal.
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(recordStaffAccess).not.toHaveBeenCalled();
  });

  it('gates on manage_billing and audits BEFORE the write, naming the customer', async () => {
    mockAdminClient();
    const rpc = mockCookieClient({ data: '2027-01-01T18:00:00+00:00', error: null });

    await rescheduleEventForAdmin('e1', '2027-01-01T18:00:00+00:00', 'האירוע נדחה לבקשת הלקוח');

    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(recordStaffAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: 'staff-1',
        permission: 'manage_billing',
        subjectType: 'event',
        subjectId: 'e1',
        ownerId: 'owner-1',
        reason: 'האירוע נדחה לבקשת הלקוח',
      }),
    );
    // Fail-closed ordering: recordStaffAccess throws on a failed insert, so the
    // write must come after it, never in parallel.
    const auditOrder = vi.mocked(recordStaffAccess).mock.invocationCallOrder[0];
    const rpcOrder = rpc.mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(rpcOrder);
  });

  it('sends the RPC through the USER-scoped client, never the service-role one', async () => {
    const admin = mockAdminClient();
    const rpc = mockCookieClient({ data: '2027-01-01T18:00:00+00:00', error: null });

    await rescheduleEventForAdmin('e1', '2027-01-01T18:00:00+00:00', 'האירוע נדחה לבקשת הלקוח');

    // admin_reschedule_event resolves the caller through auth.uid(), which is
    // null under service_role — sent that way the function refuses itself.
    expect(rpc).toHaveBeenCalledWith('admin_reschedule_event', {
      _event_id: 'e1',
      _event_date: '2027-01-01T18:00:00+00:00',
    });
    expect((admin as unknown as { rpc?: unknown }).rpc).toBeUndefined();
  });

  it('refreshes the calendar entry, which nothing else does on a date change', async () => {
    mockAdminClient();
    mockCookieClient({ data: '2027-01-01T18:00:00+00:00', error: null });

    await rescheduleEventForAdmin('e1', '2027-01-01T18:00:00+00:00', 'האירוע נדחה לבקשת הלקוח');

    // The UPDATE path, not the create-only one: syncEventToExchange returns at
    // `already_synced` for an event that has a link row, so calling it here
    // would leave the calendar showing the old date — which is exactly what
    // happened on the first real reschedule.
    expect(rescheduleEventExchangeAppointment).toHaveBeenCalledWith('e1');
    expect(syncEventToExchange).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.event.rescheduled' }),
    );
    expect(sendSlackAlert).toHaveBeenCalled();
  });

  it('never leaks raw Postgres text to the operator', async () => {
    mockAdminClient();
    mockCookieClient({
      data: null,
      error: { message: 'event_date must be at least tomorrow (Asia/Jerusalem)' },
    });

    await expect(
      rescheduleEventForAdmin('e1', '2020-01-01T18:00:00+00:00', 'האירוע נדחה לבקשת הלקוח'),
    ).rejects.toThrow('מועד האירוע חייב להיות החל ממחר');
  });

  it('reports the permission refusal in the operator’s own language', async () => {
    mockAdminClient();
    mockCookieClient({
      data: null,
      error: { message: 'insufficient privilege to reschedule an event' },
    });

    await expect(
      rescheduleEventForAdmin('e1', '2027-01-01T18:00:00+00:00', 'האירוע נדחה לבקשת הלקוח'),
    ).rejects.toThrow('אין לך הרשאה');
  });
});

// The lock is a database trigger, so the guarantee that matters is a property of
// the SQL, not of the TypeScript above it.
describe('migration 20260906203901 — the lock keeps holding', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260906203901_admin_reschedule_event.sql',
    ),
    'utf8',
  );

  it('opens the R5 lock for exactly one function and nothing else', () => {
    // Whoever sets this flag can move any date on any live event. There must be
    // one such place, inside the permission-checked function.
    const setters = sql.match(/set_config\('app\.event_reschedule', 'on'/g) ?? [];
    expect(setters).toHaveLength(1);
    const fnStart = sql.indexOf('create or replace function public.admin_reschedule_event');
    expect(fnStart).toBeGreaterThan(-1);
    expect(sql.indexOf("set_config('app.event_reschedule', 'on'")).toBeGreaterThan(fnStart);
  });

  it('checks the permission inside the database, before touching the row', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.admin_reschedule_event'));
    expect(fn).toContain("has_platform_permission('manage_billing')");
    expect(fn.indexOf('has_platform_permission')).toBeLessThan(fn.indexOf('update public.events'));
    // A locked search_path and a definer that is not the caller.
    expect(fn).toContain('security definer');
    expect(fn).toContain('set search_path = public, pg_temp');
  });

  it('still refuses a past date on the blessed path, and keeps the lock for everyone else', () => {
    expect(sql).toContain('event_date must be at least tomorrow');
    expect(sql).toContain('event_date/rsvp_deadline are locked once the event leaves draft');
  });

  it('clamps the RSVP deadline rather than letting the CHECK reject the move', () => {
    // events_rsvp_deadline_within_event requires deadline <= event day, so an
    // event moved EARLIER than its own deadline would be rejected outright.
    expect(sql).toContain('when cur_deadline is not null and cur_deadline > new_event_day');
  });

  it('is not reachable anonymously', () => {
    expect(sql).toContain('revoke all on function public.admin_reschedule_event(uuid, timestamptz) from anon');
    expect(sql).toContain('grant execute on function public.admin_reschedule_event(uuid, timestamptz) to authenticated');
  });
});
