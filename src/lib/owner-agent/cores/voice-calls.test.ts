import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/access-log', () => ({ recordStaffAccess: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { getVoiceDashboardSummary } from '@/lib/data/admin/voice-ops';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import { ANSWER_RATE_DENOM, getVoiceCallsSummary } from './voice-calls';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25; UTC midnight = 2026-09-24T00:00Z, Israel
// midnight = 2026-09-24T21:00Z, rolling 7d = 2026-09-17T22:30Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');

function db() {
  return createFakeCountClient({
    call_attempts: [
      // after Israel midnight
      { id: 'a1', status: 'completed', created_at: '2026-09-24T21:30:00Z', transcript: 'secret', access_token: 't' },
      { id: 'a2', status: 'in_progress', created_at: '2026-09-24T22:10:00Z', transcript: null, access_token: 't' },
      // between UTC midnight and Israel midnight
      { id: 'a3', status: 'no_answer', created_at: '2026-09-24T08:00:00Z', transcript: null, access_token: 't' },
      { id: 'a4', status: 'cancelled', created_at: '2026-09-24T09:00:00Z', transcript: null, access_token: 't' },
      // earlier in the week
      { id: 'a5', status: 'completed', created_at: '2026-09-20T10:00:00Z', transcript: 'x', access_token: 't' },
      { id: 'a6', status: 'failed', created_at: '2026-09-19T10:00:00Z', transcript: null, access_token: 't' },
      { id: 'a7', status: 'queued', created_at: '2026-09-18T10:00:00Z', transcript: null, access_token: 't' },
      // outside 7d, inside 30d
      { id: 'a8', status: 'no_response', created_at: '2026-09-10T10:00:00Z', transcript: null, access_token: 't' },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as unknown as User);
});

describe('getVoiceCallsSummary (core)', () => {
  it("'today' counts from Israel midnight", async () => {
    const { client } = db();
    const s = await getVoiceCallsSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({
      activeNow: 2, // a2 in_progress, a7 queued (not range-bound)
      attempts: 2, // a1, a2 — a3/a4 are before Israel midnight
      completed: 1,
      answerRate: 1, // 1 completed / 1 terminal (a2 is not terminal)
    });
  });

  it("'7d' and '30d' are rolling windows; answer rate uses the binding denominator", async () => {
    const { client } = db();
    const s7 = await getVoiceCallsSummary(client as unknown as AdminClient, '7d', NOW);
    // a1..a7; denominator = a1, a3, a5, a6 (cancelled and non-terminal excluded)
    expect(s7).toEqual({ activeNow: 2, attempts: 7, completed: 2, answerRate: 0.5 });
    const s30 = await getVoiceCallsSummary(client as unknown as AdminClient, '30d', NOW);
    expect(s30).toEqual({ activeNow: 2, attempts: 8, completed: 2, answerRate: 2 / 5 });
  });

  it('answerRate is null when nothing terminal happened in range', async () => {
    const { client } = createFakeCountClient({ call_attempts: [] });
    const s = await getVoiceCallsSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({ activeNow: 0, attempts: 0, completed: 0, answerRate: null });
  });

  it('every query is a head-only exact count; transcript/token never selected', async () => {
    const { client, calls } = db();
    await getVoiceCallsSummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.table).toBe('call_attempts');
      expect(c.columns).toBe('id');
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
    expect(calls).toContainEqual(
      expect.objectContaining({
        filters: [
          { op: 'gte', args: ['created_at', '2026-09-17T22:30:00.000Z'] },
          { op: 'in', args: ['status', [...ANSWER_RATE_DENOM]] },
        ],
      }),
    );
  });

  it('result is numbers only', async () => {
    const { client } = db();
    const s = await getVoiceCallsSummary(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
  });

  it('throws on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['call_attempts'] });
    await expect(
      getVoiceCallsSummary(client as unknown as AdminClient, '7d', NOW),
    ).rejects.toThrow();
  });
});

describe('wrapper ↔ core parity (same data, same number)', () => {
  it("/admin/voice's 7-day tiles equal the core's '7d'; its today stays UTC-midnight", async () => {
    const { client, calls } = db();
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);

    const page = await getVoiceDashboardSummary(NOW);
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
    // Same number of queries as before the refactor.
    expect(calls).toHaveLength(5);

    const core = await getVoiceCallsSummary(client as unknown as AdminClient, '7d', NOW);
    expect(page).toEqual({
      activeNow: core.activeNow,
      today: 4, // a1..a4 since 2026-09-24T00:00Z (UTC midnight — unchanged behaviour)
      last7d: core.attempts,
      completed7d: core.completed,
      answerRate7d: core.answerRate,
    });
    // The documented difference: the core's Israel-midnight 'today' is 2 here.
    const today = await getVoiceCallsSummary(client as unknown as AdminClient, 'today', NOW);
    expect(today.attempts).toBe(2);
  });

  it('the page still throws (no silent 0) when a count fails', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['call_attempts'] });
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);
    await expect(getVoiceDashboardSummary(NOW)).rejects.toThrow();
  });

  it('the page does not touch data when the gate rejects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(getVoiceDashboardSummary(NOW)).rejects.toThrow('NEXT_REDIRECT');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
