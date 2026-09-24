import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformStaff: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requirePlatformStaff } from '@/lib/auth/dal';
import { getAdminNavCounts, countNewCallbacks, countNewContacts } from '@/lib/data/admin/nav-counts';
import { getDashboardCounts } from '@/lib/data/admin/dashboard';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import {
  countNewCallbackRequests,
  countOpenContacts,
  getInquiriesSummary,
} from './inquiries';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25 (UTC date is still the 24th). Israel midnight =
// 2026-09-24T21:00Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');

// Rows carry text columns on purpose (name/email/message): the core must count
// them without ever returning any of it.
function db() {
  return createFakeCountClient({
    contact_messages: [
      { id: 'c1', status: 'new', created_at: '2026-09-24T21:30:00Z', name: 'דנה', email: 'a@b.c', message: 'hi' },
      { id: 'c2', status: 'reopened', created_at: '2026-09-20T10:00:00Z', name: 'x', email: 'x@y.z', message: 'm' },
      { id: 'c3', status: 'done', created_at: '2026-09-24T20:59:00Z', name: 'y', email: 'y@y.z', message: 'm' },
      { id: 'c4', status: 'in_progress', created_at: '2026-08-01T10:00:00Z', name: 'z', email: 'z@y.z', message: 'm' },
      { id: 'c5', status: 'new', created_at: '2026-09-17T10:00:00Z', name: 'w', email: 'w@y.z', message: 'm' },
    ],
    callback_requests: [
      { id: 'b1', status: 'new', created_at: '2026-09-24T21:00:00Z', full_name: 'q', phone: '0501234567' },
      { id: 'b2', status: 'scheduled', created_at: '2026-09-24T22:00:00Z', full_name: 'r', phone: '0501234568' },
      { id: 'b3', status: 'new', created_at: '2026-09-01T10:00:00Z', full_name: 's', phone: '0501234569' },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformStaff).mockResolvedValue({ id: 'admin-1' } as unknown as User);
  vi.mocked(hasPlatformPermission).mockResolvedValue(true);
});

describe('getInquiriesSummary (core)', () => {
  it('counts open state and range volume with Israel-midnight "today"', async () => {
    const { client } = db();
    const s = await getInquiriesSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({
      openContacts: 3, // c1 new, c2 reopened, c5 new
      newCallbacks: 2, // b1, b3
      contactsReceived: 1, // c1 only; c3 is 20:59Z = 23:59 Israel on the 24th
      callbacksReceived: 2, // b1 exactly at Israel midnight (inclusive), b2
    });
  });

  it('7d and 30d are rolling windows', async () => {
    const { client } = db();
    const s7 = await getInquiriesSummary(client as unknown as AdminClient, '7d', NOW);
    expect(s7.contactsReceived).toBe(3); // c1, c2, c3; c5 (17.9 10:00Z) is before the 17.9 22:30Z cut-off
    const s30 = await getInquiriesSummary(client as unknown as AdminClient, '30d', NOW);
    expect(s30.contactsReceived).toBe(4); // all but c4 (1.8)
    expect(s30.callbacksReceived).toBe(3);
  });

  it('every query is head-only exact count; no row data is requested', async () => {
    const { client, calls } = db();
    await getInquiriesSummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.columns).toBe('id');
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
    const since = calls.filter((c) => c.filters.some((f) => f.op === 'gte'));
    expect(since.map((c) => c.filters[0].args)).toEqual([
      ['created_at', '2026-09-17T22:30:00.000Z'],
      ['created_at', '2026-09-17T22:30:00.000Z'],
    ]);
  });

  it('result is numbers only — no name, email, phone or message text', async () => {
    const { client } = db();
    const s = await getInquiriesSummary(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
  });

  it('throws on a query error instead of reporting a confident 0', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['contact_messages'] });
    await expect(
      getInquiriesSummary(client as unknown as AdminClient, 'today', NOW),
    ).rejects.toThrow('count_open_contacts_failed');
  });
});

describe('wrapper ↔ core parity (same data, same number)', () => {
  it('nav-counts badge counters equal the core counters', async () => {
    const { client } = db();
    const c = client as unknown as AdminClient;
    expect(await countNewContacts(c)).toBe(await countOpenContacts(c));
    expect(await countNewCallbacks(c)).toBe(await countNewCallbackRequests(c));
  });

  it('getAdminNavCounts and getDashboardCounts show the core numbers', async () => {
    const { client } = db();
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);
    const core = await getInquiriesSummary(client as unknown as AdminClient, 'today', NOW);
    const nav = await getAdminNavCounts();
    const dash = await getDashboardCounts();
    expect(nav.contacts).toBe(core.openContacts);
    expect(nav.callbacks).toBe(core.newCallbacks);
    expect(dash.contacts).toBe(core.openContacts);
    expect(dash.callbacks).toBe(core.newCallbacks);
  });

  it('the nav adapter keeps its fail-soft 0 while the core throws', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['contact_messages', 'callback_requests'] });
    const c = client as unknown as AdminClient;
    expect(await countNewContacts(c)).toBe(0);
    expect(await countNewCallbacks(c)).toBe(0);
    await expect(countOpenContacts(c)).rejects.toThrow();
    await expect(countNewCallbackRequests(c)).rejects.toThrow();
  });
});
