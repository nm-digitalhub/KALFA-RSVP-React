import { describe, expect, it } from 'vitest';

import { runsFingerprint, RUNS_WINDOW } from './runs-fingerprint';

// What "the runs list changed" means, pinned as a rule.
//
// ⚠️ THE FAILURE MODE IS SILENCE, AGAIN. The workflow page polls this value and
// refreshes only when it differs, so a fingerprint that misses a change does not
// throw — the table just goes on showing yesterday's runs, which is exactly the
// bug this whole path exists to fix. Each case below is a change a reader would
// see on screen.

const run = (id: string, status: string) => ({ id, status });

describe('runsFingerprint', () => {
  it('is stable for the same rows', () => {
    const rows = [run('a', 'completed'), run('b', 'failed')];
    expect(runsFingerprint(rows)).toBe(runsFingerprint([...rows]));
  });

  it('⚠️ changes when a run is added — the case that started this', () => {
    const before = [run('a', 'completed')];
    const after = [run('new', 'running'), run('a', 'completed')];
    expect(runsFingerprint(after)).not.toBe(runsFingerprint(before));
  });

  it('⚠️ changes when a status moves, including on an older row', () => {
    // A parked run waking up behind newer ones. Fingerprinting only the newest
    // row would miss this entirely, and `logic.wait` can hold a run for days.
    const before = [run('new', 'completed'), run('old', 'waiting')];
    const after = [run('new', 'completed'), run('old', 'completed')];
    expect(runsFingerprint(after)).not.toBe(runsFingerprint(before));
  });

  it('changes when a run disappears', () => {
    expect(runsFingerprint([run('a', 'completed')])).not.toBe(
      runsFingerprint([run('a', 'completed'), run('b', 'completed')]),
    );
  });

  it('⚠️ changes when two runs swap places', () => {
    // Order is what the table renders, so a reorder is a visible change even
    // though the same ids and statuses are present.
    const rows = [run('a', 'completed'), run('b', 'failed')];
    expect(runsFingerprint(rows)).not.toBe(runsFingerprint([...rows].reverse()));
  });

  it('⚠️ cannot confuse an id boundary with a status', () => {
    // A naive concatenation would give these two the same input string.
    expect(runsFingerprint([run('a', 'b'), run('c', 'd')])).not.toBe(
      runsFingerprint([run('a', 'b:c'), run('', 'd')]),
    );
  });

  it('handles the empty list without throwing', () => {
    // A workflow that has never run still renders the component.
    expect(runsFingerprint([])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is short enough to poll', () => {
    const rows = Array.from({ length: RUNS_WINDOW }, (_, i) =>
      run(`11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, 'completed'),
    );
    expect(runsFingerprint(rows)).toHaveLength(16);
  });

  it('⚠️ the window matches what the page renders', () => {
    // `page.tsx` passes this to `listWorkflowRuns` and the route uses it to
    // limit its own query. A drift between the two would either miss a change
    // or refresh for a row nobody can see.
    expect(RUNS_WINDOW).toBe(20);
  });
});
