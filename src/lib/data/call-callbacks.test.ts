import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { CALLBACK_TOUCHPOINT_BASE, runCallbackSweep } from './call-callbacks';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { QUEUES } from '@/lib/queue/queues';

const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';

function dueRow(over: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT,
    campaign_id: CAMPAIGN,
    event_id: EVENT,
    contact_id: CONTACT,
    callback_iso: '2026-07-21T18:00:00+03:00',
    callback_when_text: 'מחר בערב',
    ...over,
  };
}

/**
 * Minimal Supabase-shaped stub. `claimWins` models the atomic
 * compare-and-set: false = another tick already took the row, which is the
 * whole point of the claim and must result in no dial.
 */
function stubAdmin(opts: {
  due?: Record<string, unknown>[];
  phone?: string | null;
  claimWins?: boolean;
  count?: number;
}) {
  const { due = [dueRow()], phone = '+972501234567', claimWins = true, count = 0 } = opts;
  const updateCalls: Record<string, unknown>[] = [];

  const from = (table: string) => {
    if (table === 'contacts') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: phone ? { normalized_phone: phone } : null }) }) }),
      };
    }
    // call_attempts — two shapes: the due-list query, the count read, and the claim.
    return {
      select: (cols: string) => {
        if (cols.includes('callback_count') && !cols.includes('campaign_id')) {
          return { eq: () => ({ maybeSingle: async () => ({ data: { callback_count: count } }) }) };
        }
        const chain = {
          not: () => chain,
          is: () => chain,
          lte: () => chain,
          order: () => chain,
          limit: async () => ({ data: due, error: null }),
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        updateCalls.push(payload);
        return {
          eq: () => ({
            is: () => ({
              select: () => ({ maybeSingle: async () => ({ data: claimWins ? { id: ATTEMPT } : null }) }),
            }),
          }),
        };
      },
    };
  };
  return { admin: { from } as never, updateCalls };
}

const boss = { send: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  boss.send = vi.fn(async () => 'job-id');
});

describe('runCallbackSweep', () => {
  it('enqueues a callRequest flagged as a callback, in the reserved touchpoint band', async () => {
    const { admin } = stubAdmin({ count: 0 });
    vi.mocked(createAdminClient).mockReturnValue(admin);

    const res = await runCallbackSweep(boss as never);

    expect(res.enqueued).toBe(1);
    const [queue, job] = boss.send.mock.calls[0];
    expect(queue).toBe(QUEUES.callRequest);
    // isCallback is what exempts the dial from already-reached. Without it the
    // dispatcher skips every callback, and the sweep silently does nothing.
    expect(job.isCallback).toBe(true);
    expect(job.callbackFromAttemptId).toBe(ATTEMPT);
    expect(job.contactId).toBe(CONTACT);
    // Must not collide with a real campaign touchpoint.
    expect(job.touchpointIndex).toBe(CALLBACK_TOUCHPOINT_BASE + 1);
    expect(job.touchpointIndex).toBeGreaterThan(CALLBACK_TOUCHPOINT_BASE);
  });

  it('separates repeat callbacks by callback_count so the UNIQUE constraint cannot reject them', async () => {
    const { admin } = stubAdmin({ count: 3 });
    vi.mocked(createAdminClient).mockReturnValue(admin);
    await runCallbackSweep(boss as never);
    expect(boss.send.mock.calls[0][1].touchpointIndex).toBe(CALLBACK_TOUCHPOINT_BASE + 4);
  });

  it('does NOT dial when the claim is lost to a concurrent tick', async () => {
    const { admin } = stubAdmin({ claimWins: false });
    vi.mocked(createAdminClient).mockReturnValue(admin);

    const res = await runCallbackSweep(boss as never);

    expect(res.enqueued).toBe(0);
    expect(boss.send).not.toHaveBeenCalled(); // a guest's phone must not ring twice
  });

  it('claims before dialling, so a failure cannot re-ring the guest on the next tick', async () => {
    const { admin, updateCalls } = stubAdmin({});
    vi.mocked(createAdminClient).mockReturnValue(admin);
    await runCallbackSweep(boss as never);
    expect(updateCalls[0]).toHaveProperty('callback_dispatched_at');
    expect(updateCalls[0]).toHaveProperty('callback_count');
  });

  it('claims and alerts instead of dialling when the contact has no phone number', async () => {
    const { admin } = stubAdmin({ phone: null });
    vi.mocked(createAdminClient).mockReturnValue(admin);

    const res = await runCallbackSweep(boss as never);

    expect(res.enqueued).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();
    // Claimed anyway — no later tick can conjure a number, so re-examining this
    // row every 5 minutes forever would be a permanent no-op loop.
    expect(sendSlackAlert).toHaveBeenCalledOnce();
  });

  it('returns 0 and sends nothing when nothing is due', async () => {
    const { admin } = stubAdmin({ due: [] });
    vi.mocked(createAdminClient).mockReturnValue(admin);
    expect((await runCallbackSweep(boss as never)).enqueued).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();
  });
});
