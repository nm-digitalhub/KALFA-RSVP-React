import { describe, expect, it } from 'vitest';

import {
  getRunsRefreshInterval,
  type WorkflowRunStatus,
} from './runs-auto-refresh';

// The refresh POLICY, stated without timers or a rendered tree.
//
// ⚠️ THIS FILE USED TO PIN THE BUG AS CORRECT. Its first version asserted that
// the interval is `null` once every run has finished — "a page left open on a
// finished workflow must cost nothing" — and every assertion passed. On
// 2026-09-18 an inbound WhatsApp message created a run at 18:55:53 and finished
// it at 18:55:57 while the page sat open and `visible`, and the table went on
// showing the previous day's two runs until it was reloaded by hand. A trigger
// fires with no browser involved, so "everything I can see has finished" says
// nothing about what is about to appear.
//
// The lesson is not "add a case". It is that a test can only ever check the
// policy someone wrote down, and this one wrote down the wrong policy
// confidently. The cost argument that justified it was real, and is answered
// somewhere else now: the idle tick asks `/runs/latest` — ONE query returning a
// hash — and only calls `router.refresh()` when that hash differs.

/** Exactly the values `workflow_runs.status` allows, read off the CHECK constraint. */
const ALL: readonly WorkflowRunStatus[] = [
  'pending',
  'running',
  'waiting',
  'cancelling',
  'completed',
  'incomplete',
  'failed',
  'cancelled',
];

const TERMINAL: readonly WorkflowRunStatus[] = [
  'completed',
  'incomplete',
  'failed',
  'cancelled',
];

describe('getRunsRefreshInterval', () => {
  it('⚠️ keeps checking after every run has finished', () => {
    // The regression. A trigger can create a run at any moment, and the page
    // has no other way to hear about it.
    expect(getRunsRefreshInterval(TERMINAL)).toBe(25_000);
  });

  it('⚠️ keeps checking on a workflow that has never run', () => {
    // The emptiest case, and the one most likely to be watched: someone has
    // just armed a workflow and is waiting for the first message to arrive.
    expect(getRunsRefreshInterval([])).toBe(25_000);
  });

  it('⚠️ never returns null — going quiet is what hid a real run', () => {
    for (const status of ALL) {
      expect(getRunsRefreshInterval([status]), status).toBeTypeOf('number');
    }
    expect(getRunsRefreshInterval([])).toBeTypeOf('number');
  });

  it('polls quickly while the engine is actually moving a run', () => {
    for (const status of ['pending', 'running', 'cancelling'] as const) {
      expect(getRunsRefreshInterval([status]), status).toBe(4_000);
    }
  });

  it('⚠️ backs off for a parked run, which is not a busy state', () => {
    // `logic.wait` parks a run for minutes or days. Polling every four seconds
    // for three days to watch a value that cannot change until a scheduled job
    // fires is the mistake this separation exists to avoid.
    expect(getRunsRefreshInterval(['waiting'])).toBe(60_000);
  });

  it('an active run outranks a parked one', () => {
    expect(getRunsRefreshInterval(['waiting', 'running'])).toBe(4_000);
    expect(getRunsRefreshInterval(['running', 'waiting'])).toBe(4_000);
  });

  it('finished runs beside a live one do not slow it down', () => {
    expect(getRunsRefreshInterval([...TERMINAL, 'running'])).toBe(4_000);
    expect(getRunsRefreshInterval([...TERMINAL, 'waiting'])).toBe(60_000);
  });

  it('⚠️ every status the database allows is classified as busy or not', () => {
    // Fail-closed: a status added to the CHECK constraint and not to this
    // policy falls through to the idle rate, which is correct-but-slow rather
    // than silently wrong. This states which bucket each one lands in so that
    // fall-through is a visible decision.
    for (const status of ALL) {
      const expected = TERMINAL.includes(status) ? 25_000 : expect.any(Number);
      expect(getRunsRefreshInterval([status]), status).toEqual(expected);
    }
  });

  it('⚠️ a live run always polls faster than a parked or idle page', () => {
    // States the ordering as a relationship rather than as three magic numbers,
    // so tuning any of them cannot accidentally invert them.
    const active = getRunsRefreshInterval(['running']);
    const parked = getRunsRefreshInterval(['waiting']);
    const idle = getRunsRefreshInterval(TERMINAL);

    expect(active).toBeLessThan(idle);
    expect(idle).toBeLessThan(parked);
  });
});
