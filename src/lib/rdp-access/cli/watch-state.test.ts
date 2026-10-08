import { describe, expect, it } from 'vitest';

import { RDP_MINUTES_PRESETS } from '../policy';
import { clampSelected, handleWatchKey, hasNewRequest, INITIAL_WATCH_STATE, type WatchKey, type WatchRow, type WatchState } from './watch-state';

const ROWS: WatchRow[] = [
  { id: 'aaaa', requestedMinutes: 60 },
  { id: 'bbbb', requestedMinutes: 240 },
  { id: 'cccc', requestedMinutes: 45 },
];
const key = (input: string, extra: Partial<WatchKey> = {}): WatchKey => ({ input, ...extra });
const at = (selected: number, mode: WatchState['mode'] = { kind: 'list' }): WatchState => ({ selected, mode });

describe('clampSelected', () => {
  it.each([
    [0, 0, 0],
    [5, 0, 0],
    [-1, 3, 0],
    [3, 3, 2],
    [1, 3, 1],
  ])('clamps %s in a list of %s to %s', (selected, length, expected) => {
    expect(clampSelected(selected, length)).toBe(expected);
  });
});

describe('list mode', () => {
  it('moves with the arrows and with j/k, never past the ends', () => {
    expect(handleWatchKey(at(0), ROWS, null, key('', { downArrow: true })).state.selected).toBe(1);
    expect(handleWatchKey(at(2), ROWS, null, key('j')).state.selected).toBe(2);
    expect(handleWatchKey(at(0), ROWS, null, key('k')).state.selected).toBe(0);
    expect(handleWatchKey(at(2), ROWS, null, key('', { upArrow: true })).state.selected).toBe(1);
  });

  it('quits on q and on Ctrl-C, in any mode', () => {
    expect(handleWatchKey(at(0), ROWS, null, key('q')).effect).toEqual({ kind: 'quit' });
    expect(handleWatchKey(at(0, { kind: 'deny', requestId: 'cccc' }), ROWS, null, key('c', { ctrl: true })).effect).toEqual({ kind: 'quit' });
  });

  it('never acts on a single key: a, d and r only open a confirmation', () => {
    for (const k of ['a', 'd', 'r']) {
      expect(handleWatchKey(at(0), ROWS, 'grant-1', key(k)).effect).toBeUndefined();
    }
  });

  it('opens the approval on the preset nearest to the requested duration', () => {
    expect(handleWatchKey(at(0), ROWS, null, key('a')).state.mode).toEqual({ kind: 'approve', requestId: 'aaaa', minutes: 60 });
    expect(handleWatchKey(at(1), ROWS, null, key('a')).state.mode).toEqual({ kind: 'approve', requestId: 'bbbb', minutes: 240 });
    expect(handleWatchKey(at(2), ROWS, null, key('a')).state.mode).toEqual({ kind: 'approve', requestId: 'cccc', minutes: 30 });
  });

  it('ignores approve and deny with nothing selected, and revoke without an active grant', () => {
    expect(handleWatchKey(INITIAL_WATCH_STATE, [], null, key('a')).state.mode.kind).toBe('list');
    expect(handleWatchKey(INITIAL_WATCH_STATE, [], null, key('d')).state.mode.kind).toBe('list');
    expect(handleWatchKey(INITIAL_WATCH_STATE, ROWS, null, key('r')).state.mode.kind).toBe('list');
    expect(handleWatchKey(INITIAL_WATCH_STATE, ROWS, 'grant-1', key('r')).state.mode.kind).toBe('revoke');
  });

  it('does not use a stale selection after the list shrank', () => {
    const result = handleWatchKey(at(9), ROWS, null, key('a'));
    expect(result.state.selected).toBe(2);
  });
});

describe('approve mode', () => {
  const approving = (minutes: number) => at(0, { kind: 'approve', requestId: 'aaaa', minutes });

  it('cycles through the presets with the arrows, wrapping around', () => {
    const last = RDP_MINUTES_PRESETS[RDP_MINUTES_PRESETS.length - 1]!;
    const first = RDP_MINUTES_PRESETS[0]!;
    expect(handleWatchKey(approving(last), ROWS, null, key('', { rightArrow: true })).state.mode).toEqual({ kind: 'approve', requestId: 'aaaa', minutes: first });
    expect(handleWatchKey(approving(first), ROWS, null, key('', { leftArrow: true })).state.mode).toEqual({ kind: 'approve', requestId: 'aaaa', minutes: last });
  });

  it('approves only on Enter, with the chosen duration and the selected request', () => {
    expect(handleWatchKey(approving(120), ROWS, null, key('y')).effect).toBeUndefined();
    const result = handleWatchKey(at(1, { kind: 'approve', requestId: 'bbbb', minutes: 120 }), ROWS, null, key('', { return: true }));
    expect(result.effect).toEqual({ kind: 'approve', requestId: 'bbbb', minutes: 120 });
    expect(result.state.mode.kind).toBe('list');
  });

  it('backs out with Escape or n and does nothing', () => {
    for (const k of [key('', { escape: true }), key('n')]) {
      const result = handleWatchKey(approving(60), ROWS, null, k);
      expect(result.effect).toBeUndefined();
      expect(result.state.mode.kind).toBe('list');
    }
  });
});

describe('deny and revoke modes', () => {
  it('act only on y', () => {
    expect(handleWatchKey(at(2, { kind: 'deny', requestId: 'cccc' }), ROWS, null, key('', { return: true })).effect).toBeUndefined();
    expect(handleWatchKey(at(2, { kind: 'deny', requestId: 'cccc' }), ROWS, null, key('y')).effect).toEqual({ kind: 'deny', requestId: 'cccc' });
    expect(handleWatchKey(at(0, { kind: 'revoke', grantId: 'grant-1' }), ROWS, 'grant-1', key('y')).effect).toEqual({ kind: 'revoke', grantId: 'grant-1' });
  });

  it('cancel on Escape or n', () => {
    for (const mode of [{ kind: 'deny', requestId: 'cccc' }, { kind: 'revoke', grantId: 'grant-1' }] as const) {
      const result = handleWatchKey(at(0, mode), ROWS, 'grant-1', key('n'));
      expect(result.effect).toBeUndefined();
      expect(result.state.mode.kind).toBe('list');
    }
  });
});


describe('confirmation identity across refreshes', () => {
  it('approves the original request after a new row moves into its position', () => {
    const opened = handleWatchKey(at(0), ROWS, null, key('a')).state;
    const reordered = [ROWS[1]!, ROWS[0]!, ROWS[2]!];
    expect(handleWatchKey(opened, reordered, null, key('', { return: true })).effect)
      .toEqual({ kind: 'approve', requestId: 'aaaa', minutes: 60 });
  });

  it('denies the original request after rows reorder', () => {
    const opened = handleWatchKey(at(0), ROWS, null, key('d')).state;
    expect(handleWatchKey(opened, [...ROWS].reverse(), null, key('y')).effect)
      .toEqual({ kind: 'deny', requestId: 'aaaa' });
  });

  it.each(['a', 'd'])('cancels %s when the original request disappears', (input) => {
    const opened = handleWatchKey(at(0), ROWS, null, key(input)).state;
    const result = handleWatchKey(opened, ROWS.slice(1), null, key('y', { return: true }));
    expect(result.effect).toBeUndefined();
    expect(result.state.mode.kind).toBe('list');
  });

  it('does not revoke a replacement grant', () => {
    const opened = handleWatchKey(at(0), ROWS, 'old-grant', key('r')).state;
    const result = handleWatchKey(opened, ROWS, 'new-grant', key('y'));
    expect(result.effect).toBeUndefined();
    expect(result.state.mode.kind).toBe('list');
  });

  it('passes the exact confirmed grant ID to the revoke command', () => {
    const opened = handleWatchKey(at(0), ROWS, 'old-grant', key('r')).state;
    expect(handleWatchKey(opened, ROWS, 'old-grant', key('y')).effect)
      .toEqual({ kind: 'revoke', grantId: 'old-grant' });
  });
});


describe('hasNewRequest', () => {
  it('never rings for the first snapshot, even with requests waiting', () => {
    expect(hasNewRequest(null, [{ id: 'a' }, { id: 'b' }])).toBe(false);
  });
  it('rings when a request that was not there before appears', () => {
    expect(hasNewRequest(new Set(['a']), [{ id: 'a' }, { id: 'b' }])).toBe(true);
  });
  it('stays quiet when nothing arrived or requests only left', () => {
    expect(hasNewRequest(new Set(['a', 'b']), [{ id: 'b' }, { id: 'a' }])).toBe(false);
    expect(hasNewRequest(new Set(['a', 'b']), [{ id: 'a' }])).toBe(false);
    expect(hasNewRequest(new Set(['a']), [])).toBe(false);
  });
});
