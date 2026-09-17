import { describe, expect, it } from 'vitest';

import {
  getRunsRefreshInterval,
  type WorkflowRunStatus,
} from './runs-auto-refresh';

// The refresh POLICY, stated without timers or a rendered tree.
//
// The interval is the whole decision this component makes; everything around it
// is a `setInterval` and a visibility check. Pinning it here means the rule can
// be read and argued with directly, and means a change to it cannot pass as an
// incidental edit to an effect.

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
  it('⚠️ stops entirely once every run has finished', () => {
    // The point of the component. A page left open on a finished workflow must
    // cost nothing — each cycle is seven uncached queries.
    expect(getRunsRefreshInterval(TERMINAL)).toBeNull();
    expect(getRunsRefreshInterval([])).toBeNull();
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

  it('finished runs beside an active one do not slow it down', () => {
    expect(getRunsRefreshInterval([...TERMINAL, 'running'])).toBe(4_000);
    expect(getRunsRefreshInterval([...TERMINAL, 'waiting'])).toBe(60_000);
  });

  it('⚠️ every status the database allows is classified', () => {
    // Fail-closed: a status added to the CHECK constraint and not to this
    // policy would silently fall through to "never refresh", and the table
    // would go stale for exactly the state someone just introduced.
    for (const status of ALL) {
      const interval = getRunsRefreshInterval([status]);
      const expected = TERMINAL.includes(status) ? null : expect.any(Number);
      expect(interval, status).toEqual(expected);
    }
  });

  it('a non-terminal status always polls faster than a parked one', () => {
    // States the ordering as a relationship rather than as two magic numbers,
    // so tuning either one cannot accidentally invert them.
    const active = getRunsRefreshInterval(['running'])!;
    const parked = getRunsRefreshInterval(['waiting'])!;
    expect(active).toBeLessThan(parked);
  });
});
