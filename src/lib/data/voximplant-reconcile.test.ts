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

import { sendSlackAlert } from '@/lib/alerts/slack';

import { __resetCallReconcileStateForTests, runCallReconcile } from './voximplant-reconcile';

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
