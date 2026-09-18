import { describe, expect, it } from 'vitest';

import { shouldAutoWatch, type NewestRun } from './run-auto-watch';

// When a run gets put on the canvas by itself.
//
// Every clause in this rule is a way the feature could go wrong rather than a
// condition for its own sake, so each gets its own case with the failure it
// prevents written down. A wrong `true` here is not a crash — it is the canvas
// changing under someone's hands, which is how a feature like this earns being
// switched off.

const run = (id: string, status = 'running'): NewestRun => ({ id, status });

const base = {
  enabled: true,
  isFirstRender: false,
  newest: run('new'),
  previousId: 'old',
  watchedByUser: false,
};

describe('shouldAutoWatch', () => {
  it('attaches to a run that appeared while the page was open', () => {
    expect(shouldAutoWatch(base)).toBe(true);
  });

  it('⚠️ does nothing on the first render, whatever is newest', () => {
    // Otherwise opening the editor lights the canvas with yesterday's run. The
    // rule is "a run that APPEARED while I was looking", not "the newest run".
    expect(shouldAutoWatch({ ...base, isFirstRender: true, previousId: null })).toBe(false);
  });

  it('does nothing when the same run is still newest', () => {
    // The table re-renders on every poll; only a CHANGE is an event.
    expect(shouldAutoWatch({ ...base, newest: run('old'), previousId: 'old' })).toBe(false);
  });

  it('does nothing on a workflow with no runs at all', () => {
    expect(shouldAutoWatch({ ...base, newest: null })).toBe(false);
  });

  it('⚠️ does nothing while the switch is off', () => {
    expect(shouldAutoWatch({ ...base, enabled: false })).toBe(false);
  });

  it('⚠️ never takes the canvas from a run someone opened by hand', () => {
    // They are reading it. Swapping it out mid-read is the behaviour this guard
    // exists to prevent, and the store cannot answer it — `runId` says which run
    // is shown, never why.
    expect(shouldAutoWatch({ ...base, watchedByUser: true })).toBe(false);
  });

  it('⚠️ never attaches to a parked run', () => {
    // `waiting` is not terminal, so the stream never closes: the server caps a
    // connection at five minutes and EventSource reconnects, for as long as the
    // tab stays open. Acceptable when a person chose it; not unasked, on every
    // open tab.
    expect(shouldAutoWatch({ ...base, newest: run('new', 'waiting') })).toBe(false);
  });

  it('attaches for every other non-terminal status', () => {
    for (const status of ['pending', 'running', 'cancelling'] as const) {
      expect(shouldAutoWatch({ ...base, newest: run('new', status) }), status).toBe(true);
    }
  });

  it('attaches for a run that is already finished', () => {
    // Short workflows are over before the table notices — the measured run took
    // 2.1 seconds. Showing the finished state without a click is still the point.
    for (const status of ['completed', 'failed', 'incomplete', 'cancelled'] as const) {
      expect(shouldAutoWatch({ ...base, newest: run('new', status) }), status).toBe(true);
    }
  });

  it('⚠️ the switch outranks everything except the first render', () => {
    // Stated as a relationship so a future clause cannot accidentally let an
    // "off" switch through.
    for (const extra of [
      { watchedByUser: true },
      { newest: run('new', 'waiting') },
      { newest: null },
    ]) {
      expect(shouldAutoWatch({ ...base, ...extra, enabled: false })).toBe(false);
    }
  });
});
