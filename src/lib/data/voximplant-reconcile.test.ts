import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));

// The reconciler's single query chain: .from().select().in().lt() — the awaited
// terminal `.lt()` resolves to { data, error }.
const { ltMock } = vi.hoisted(() => ({ ltMock: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ in: () => ({ lt: ltMock }) }) }),
  }),
}));

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

// This file only needs each table's pre-terminal vocabulary constant, not the
// real DAL (which pulls in console-calls.ts's own import chain) — mirrors
// callback-request-attempts.test.ts / sales-call-attempts.test.ts's own
// convention of stubbing rather than importing the real module in a unit test.
vi.mock('@/lib/data/callback-request-attempts', () => ({
  DISPATCH_PRE_TERMINAL: ['queued', 'dialing', 'in_progress'],
}));
vi.mock('@/lib/data/sales-call-attempts', () => ({
  DISPATCH_PRE_TERMINAL: ['queued', 'dialing', 'in_progress'],
}));

import { sendSlackAlert } from '@/lib/alerts/slack';

import {
  __resetCallReconcileStateForTests,
  runCallReconcile,
  __resetCallbackDispatchReconcileStateForTests,
  runCallbackDispatchReconcile,
  __resetSalesDispatchReconcileStateForTests,
  runSalesDispatchReconcile,
} from './voximplant-reconcile';

const stuck = (...ids: string[]) =>
  ltMock.mockResolvedValueOnce({ data: ids.map((id) => ({ id })), error: null });
const empty = () => ltMock.mockResolvedValueOnce({ data: [], error: null });
const failed = () => ltMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

const TICK_MS = 10 * 60 * 1000; // the worker's */10 schedule
const REALERT_MS = 6 * 60 * 60 * 1000;

describe('runCallReconcile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T06:00:00Z'));
    __resetCallReconcileStateForTests();
    ltMock.mockReset();
    vi.mocked(sendSlackAlert).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('alerts once for a new stuck set, with count + sorted ids', async () => {
    stuck('b', 'a');
    await runCallReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'send_health',
        source: 'voximplant-reconcile',
        detail: '2 pre-terminal rows older than 15m',
        fields: { stuck: 2, ids: 'a, b' },
      }),
    );
  });

  it('suppresses repeat ticks while the same set persists', async () => {
    stuck('a');
    await runCallReconcile();
    vi.advanceTimersByTime(TICK_MS);
    stuck('a');
    await runCallReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
  });

  it('re-alerts as a reminder once the interval elapses', async () => {
    stuck('a');
    await runCallReconcile();
    vi.advanceTimersByTime(REALERT_MS);
    stuck('a');
    await runCallReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(2);
  });

  it('alerts immediately when the stuck set changes', async () => {
    stuck('a');
    await runCallReconcile();
    vi.advanceTimersByTime(TICK_MS);
    stuck('a', 'b');
    await runCallReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(2);
  });

  it('a cleared set resets the state so the next incident alerts at once', async () => {
    stuck('a');
    await runCallReconcile();
    empty();
    await runCallReconcile();
    vi.advanceTimersByTime(TICK_MS); // well under the reminder interval
    stuck('a');
    await runCallReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(2);
  });

  it('a query error is a silent no-op that keeps the alert state', async () => {
    stuck('a');
    await runCallReconcile();
    failed();
    await runCallReconcile();
    vi.advanceTimersByTime(TICK_MS);
    stuck('a');
    await runCallReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
  });

  it('caps the listed ids at 5 with an ellipsis', async () => {
    stuck('f', 'e', 'd', 'c', 'b', 'a');
    await runCallReconcile();
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ fields: { stuck: 6, ids: 'a, b, c, d, e …' } }),
    );
  });
});

// The other two reconcilers (2026-08-22 extension) share makeStuckAlerter's
// dedup/cadence logic verbatim with runCallReconcile above — that logic is
// already exercised in full detail there. These two blocks only need to
// confirm (a) each one's own edge-triggered dedup state is genuinely
// independent (a stuck row in one table must not suppress or force an alert
// for another), and (b) each reports its own source/title.
function describeDispatchReconciler(
  name: string,
  run: () => Promise<void>,
  reset: () => void,
  source: string,
) {
  describe(name, () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-19T06:00:00Z'));
      reset();
      ltMock.mockReset();
      vi.mocked(sendSlackAlert).mockReset();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('alerts once for a new stuck set, tagged with its own source', async () => {
      stuck('a');
      await run();
      expect(sendSlackAlert).toHaveBeenCalledTimes(1);
      expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ source }));
    });

    it('suppresses repeat ticks while the same set persists', async () => {
      stuck('a');
      await run();
      vi.advanceTimersByTime(TICK_MS);
      stuck('a');
      await run();
      expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    });

    it('a cleared set resets the state so the next incident alerts at once', async () => {
      stuck('a');
      await run();
      empty();
      await run();
      vi.advanceTimersByTime(TICK_MS);
      stuck('a');
      await run();
      expect(sendSlackAlert).toHaveBeenCalledTimes(2);
    });

    it('a query error is a silent no-op that keeps the alert state', async () => {
      stuck('a');
      await run();
      failed();
      await run();
      vi.advanceTimersByTime(TICK_MS);
      stuck('a');
      await run();
      expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    });
  });
}

describeDispatchReconciler(
  'runCallbackDispatchReconcile',
  runCallbackDispatchReconcile,
  __resetCallbackDispatchReconcileStateForTests,
  'voximplant-reconcile-meeting-confirm',
);

describeDispatchReconciler(
  'runSalesDispatchReconcile',
  runSalesDispatchReconcile,
  __resetSalesDispatchReconcileStateForTests,
  'voximplant-reconcile-sales',
);

describe('independent per-table dedup state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T06:00:00Z'));
    __resetCallReconcileStateForTests();
    __resetCallbackDispatchReconcileStateForTests();
    __resetSalesDispatchReconcileStateForTests();
    ltMock.mockReset();
    vi.mocked(sendSlackAlert).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('an already-alerted call_attempts set does not suppress a NEW stuck set on the meeting-confirm table', async () => {
    stuck('a');
    await runCallReconcile();
    stuck('x');
    await runCallbackDispatchReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(2);
  });

  it('a stuck row appearing on the sales table does not force a re-alert on the already-quiet call_attempts table', async () => {
    stuck('a');
    await runCallReconcile();
    stuck('a'); // same set, same tick — call_attempts should stay suppressed
    await runCallReconcile();
    stuck('y'); // unrelated new incident on a different table
    await runSalesDispatchReconcile();
    expect(sendSlackAlert).toHaveBeenCalledTimes(2); // 1 (call) + 1 (sales), not 3
  });
});
