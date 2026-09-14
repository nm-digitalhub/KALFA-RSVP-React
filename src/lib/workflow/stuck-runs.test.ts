import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));

import { redeliverStuckWaitingRuns } from './enqueue';
import { listOrphanedWaitingSteps, listStuckWaitingRuns } from './store';

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
    in: (...a: unknown[]) => (filters.push(['in', ...a]), chain),
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

// The CRASH half of the wait — the gap the REGISTER→CHECK handshake cannot close.
//
// ⚠️ PARKING IS TWO WRITES WITH NO TRANSACTION. `beginWait` moves the step to
// 'waiting'; `setRunStatus` then moves the run to 'waiting' with its `resume_at`.
// A process dying between them leaves a parked step under a run that still says
// 'running' — and `listStuckWaitingRuns` reads `workflow_runs.status =
// 'waiting'`, which is precisely the write that never happened. Nothing else
// looked, so the run was stranded: every pg-boss retry met the parked step, read
// `in_flight`, and came back `contended` until the job was gone.
describe('listOrphanedWaitingSteps', () => {
  it('⚠️ starts from the STEP table, because the run row is the unreliable half', async () => {
    const { filters } = mockDb([]);
    await listOrphanedWaitingSteps(900);

    // The step is what parked, so the step is what is asked about.
    expect(filters).toContainEqual(['eq', 'status', 'waiting']);
    expect(filters).toContainEqual(['not', 'wait_until', 'is', null]);

    // And the orphan is told apart from an ordinary park by the RUN's status —
    // through an inner join, so a step whose run vanished is not resurrected.
    const select = filters.find((f) => f[0] === 'select');
    expect(String(select?.[1])).toContain('workflow_runs!inner');
    expect(filters).toContainEqual(['in', 'workflow_runs.status', ['running', 'pending']]);
  });

  it('⚠️ looks only at deadlines already PAST, by a grace period', async () => {
    // The run row is written microseconds after the step in the healthy case, so
    // a sweep without a grace window would fight every ordinary park.
    const { filters } = mockDb([]);
    const before = Date.now();
    await listOrphanedWaitingSteps(900);

    const lt = filters.find((f) => f[0] === 'lt')!;
    expect(lt[1]).toBe('wait_until');
    expect(Date.parse(String(lt[2]))).toBeLessThanOrEqual(before - 900_000 + 1_000);
  });
});
