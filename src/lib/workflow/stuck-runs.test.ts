import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));

import { redeliverStuckWaitingRuns } from './enqueue';
import { listStuckWaitingRuns } from './store';

// A parked run is woken by ONE pg-boss job. Lose it and the run sleeps for ever:
// `workflow_runs` has no other timer, and disarming the workflow does not touch
// runs already in flight. This sweep is the only thing that notices.
//
// The FILTERS are the whole safety story, so they are what gets asserted — a
// sweep that picked up runs which are merely early would re-deliver healthy
// parks on every tick.

type Filter = [string, ...unknown[]];

function mockDb(rows: { id: string; resume_at: string | null }[]) {
  const filters: Filter[] = [];
  const chain: Record<string, unknown> = {
    select: (...a: unknown[]) => (filters.push(['select', ...a]), chain),
    eq: (...a: unknown[]) => (filters.push(['eq', ...a]), chain),
    not: (...a: unknown[]) => (filters.push(['not', ...a]), chain),
    lt: (...a: unknown[]) => (filters.push(['lt', ...a]), chain),
    order: (...a: unknown[]) => (filters.push(['order', ...a]), chain),
    limit: async (...a: unknown[]) => {
      filters.push(['limit', ...a]);
      return { data: rows, error: null };
    },
  };
  adminMock.mockReturnValue({ from: () => chain });
  return { filters };
}

beforeEach(() => vi.clearAllMocks());

describe('listStuckWaitingRuns', () => {
  it('⚠️ asks only for PARKED runs whose deadline has already passed', async () => {
    const { filters } = mockDb([]);
    const before = Date.now();
    await listStuckWaitingRuns(300);

    expect(filters).toContainEqual(['eq', 'status', 'waiting']);
    // Never a row with no deadline: `resume_at` is null on every run that is not
    // parked, and `lt` on null matches nothing anyway — asserted so the intent
    // survives a rewrite of the query.
    expect(filters).toContainEqual(['not', 'resume_at', 'is', null]);

    const lt = filters.find((f) => f[0] === 'lt')!;
    expect(lt[1]).toBe('resume_at');
    // The cutoff is in the PAST by the grace period. A sweep that used `now`
    // would race pg-boss on every healthy park and re-deliver it.
    const cutoff = new Date(lt[2] as string).getTime();
    expect(cutoff).toBeLessThanOrEqual(before - 300_000 + 50);
    expect(cutoff).toBeGreaterThan(before - 300_000 - 5_000);
  });

  it('the grace period is configurable, and defaults to minutes not seconds', async () => {
    const { filters } = mockDb([]);
    const before = Date.now();
    await listStuckWaitingRuns();
    const cutoff = new Date(filters.find((f) => f[0] === 'lt')![2] as string).getTime();
    // Default 300s. Anything much smaller races the queue it is meant to backstop.
    expect(before - cutoff).toBeGreaterThanOrEqual(290_000);
  });

  it('⚠️ returns the deadline alongside the id — the caller needs BOTH', async () => {
    // The re-delivery folds `resumeAt` into the pg-boss job id so it rebuilds
    // the exact id the lost wake-up carried. Without it the caller would reuse
    // the FIRST delivery's id, which is long completed, and pg-boss inserts with
    // ON CONFLICT DO NOTHING — the rescue would vanish silently.
    mockDb([{ id: 'run-1', resume_at: '2026-09-14T07:35:53.000Z' }]);
    expect(await listStuckWaitingRuns()).toEqual([
      { runId: 'run-1', resumeAt: '2026-09-14T07:35:53.000Z' },
    ]);
  });

  it('drops a row with no deadline rather than crashing on it', async () => {
    mockDb([
      { id: 'run-1', resume_at: null },
      { id: 'run-2', resume_at: '2026-09-14T07:00:00.000Z' },
    ]);
    expect(await listStuckWaitingRuns()).toEqual([
      { runId: 'run-2', resumeAt: '2026-09-14T07:00:00.000Z' },
    ]);
  });
});

describe('redeliverStuckWaitingRuns', () => {
  it('⚠️ re-delivers with the ORIGINAL deadline, not with "now"', async () => {
    // THE LINE A FAULT INJECTION PROVED IS LOAD-BEARING AND UNTESTED. The
    // deadline is folded into the pg-boss job id, so passing it rebuilds the id
    // the lost wake-up carried. Omit it and the id becomes the FIRST delivery's
    // — long completed — and pg-boss inserts with ON CONFLICT DO NOTHING, so the
    // rescue is dropped in silence and the run stays parked for ever.
    const send = vi.fn(
      async (_queue: string, _data: unknown, _opts: { startAfter?: Date; id?: string }) =>
        undefined,
    );
    const boss = { send } as unknown as Parameters<typeof redeliverStuckWaitingRuns>[0];

    const n = await redeliverStuckWaitingRuns(boss, async () => [
      { runId: 'run-1', resumeAt: '2026-09-14T07:35:53.000Z' },
      { runId: 'run-2', resumeAt: '2026-09-14T08:00:00.000Z' },
    ]);

    expect(n).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    for (const [i, iso] of [
      [0, '2026-09-14T07:35:53.000Z'],
      [1, '2026-09-14T08:00:00.000Z'],
    ] as const) {
      const opts = send.mock.calls[i]![2];
      expect(opts.startAfter).toBeInstanceOf(Date);
      expect(opts.startAfter!.toISOString()).toBe(iso);
    }

    // Two different deadlines must not collide on one job id.
    const ids = send.mock.calls.map((c) => c[2].id);
    expect(new Set(ids).size).toBe(2);
  });

  it('does nothing, quietly, when nothing is stuck', async () => {
    const send = vi.fn(
      async (_queue: string, _data: unknown, _opts: { startAfter?: Date; id?: string }) =>
        undefined,
    );
    const boss = { send } as unknown as Parameters<typeof redeliverStuckWaitingRuns>[0];
    expect(await redeliverStuckWaitingRuns(boss, async () => [])).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
