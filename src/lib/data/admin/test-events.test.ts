import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  getTestEventStatus,
  markEventAsTest,
  purgeTestEvent,
  unmarkEventAsTest,
} from './test-events';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

// A real v4 id (Zod 4's z.uuid() rejects non-v4 fixtures).
const EVENT_ID = '659ae5e7-268b-4f04-abd8-fbb89fc3ebe4';
const STAFF: User = { id: 'staff-user-1' } as unknown as User;

function mockAdmin(opts: {
  rpc?: { data: unknown; error: unknown };
  markerRow?: { marked_at: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpc ?? { data: null, error: null });
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.markerRow ?? null, error: null }),
  };
  const from = vi.fn().mockReturnValue(chain);
  vi.mocked(createAdminClient).mockReturnValue({ rpc, from } as unknown as ReturnType<
    typeof createAdminClient
  >);
  return { rpc, from, chain };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(STAFF);
});

describe('markEventAsTest / unmarkEventAsTest', () => {
  it('gates on events.mark_test and passes the verified staff id as the actor', async () => {
    const { rpc } = mockAdmin({ rpc: { data: 'marked', error: null } });
    await expect(markEventAsTest(EVENT_ID)).resolves.toBe('marked');
    expect(requirePlatformPermission).toHaveBeenCalledWith('events.mark_test');
    expect(rpc).toHaveBeenCalledWith('mark_test_event', { p_event: EVENT_ID, p_actor: STAFF.id });
  });

  it('unmark uses the same key and its own function', async () => {
    const { rpc } = mockAdmin({ rpc: { data: 'unmarked', error: null } });
    await expect(unmarkEventAsTest(EVENT_ID)).resolves.toBe('unmarked');
    expect(requirePlatformPermission).toHaveBeenCalledWith('events.mark_test');
    expect(rpc).toHaveBeenCalledWith('unmark_test_event', { p_event: EVENT_ID, p_actor: STAFF.id });
  });

  it('never reaches the database when the permission check refuses', async () => {
    const { rpc } = mockAdmin({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(markEventAsTest(EVENT_ID)).rejects.toThrow('NEXT_REDIRECT');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed event id before any database call', async () => {
    const { rpc } = mockAdmin({});
    await expect(markEventAsTest('not-a-uuid')).rejects.toThrow('מזהה אירוע אינו תקין');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('purgeTestEvent', () => {
  it('gates on the separate events.purge_test key', async () => {
    const { rpc } = mockAdmin({ rpc: { data: 'purged', error: null } });
    await expect(purgeTestEvent(EVENT_ID)).resolves.toBe('purged');
    expect(requirePlatformPermission).toHaveBeenCalledWith('events.purge_test');
    expect(requirePlatformPermission).not.toHaveBeenCalledWith('events.mark_test');
    expect(rpc).toHaveBeenCalledWith('purge_test_event', { p_event: EVENT_ID, p_actor: STAFF.id });
  });

  it('passes refusals through as typed outcomes', async () => {
    mockAdmin({ rpc: { data: 'financial_activity', error: null } });
    await expect(purgeTestEvent(EVENT_ID)).resolves.toBe('financial_activity');
  });

  it('throws on an outcome the function never returns, instead of guessing a branch', async () => {
    mockAdmin({ rpc: { data: 'something_new', error: null } });
    await expect(purgeTestEvent(EVENT_ID)).rejects.toThrow();
  });

  it('throws a safe message on a database error', async () => {
    mockAdmin({ rpc: { data: null, error: { message: 'raw db detail' } } });
    await expect(purgeTestEvent(EVENT_ID)).rejects.toThrow('מחיקת אירוע הבדיקה נכשלה');
  });
});

describe('getTestEventStatus', () => {
  it("reads under the page's own key and reports marker + blocker", async () => {
    const { rpc, from } = mockAdmin({
      rpc: { data: 'financial_activity', error: null },
      markerRow: { marked_at: '2026-09-29T00:00:00.000Z' },
    });
    await expect(getTestEventStatus(EVENT_ID)).resolves.toEqual({
      marked: true,
      markedAt: '2026-09-29T00:00:00.000Z',
      purgeBlocker: 'financial_activity',
    });
    expect(requirePlatformPermission).toHaveBeenCalledWith('view_events');
    expect(from).toHaveBeenCalledWith('test_events');
    expect(rpc).toHaveBeenCalledWith('test_event_purge_blocker', { p_event: EVENT_ID });
  });

  it('an unmarked event with no money activity', async () => {
    mockAdmin({ rpc: { data: null, error: null }, markerRow: null });
    await expect(getTestEventStatus(EVENT_ID)).resolves.toEqual({
      marked: false,
      markedAt: null,
      purgeBlocker: null,
    });
  });
});
