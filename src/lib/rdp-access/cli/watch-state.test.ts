import { describe, expect, it } from 'vitest';

import { RDP_MINUTES_PRESETS } from '../policy';
import { clampSelected, handleWatchKey, INITIAL_WATCH_STATE, type WatchKey, type WatchRow, type WatchState } from './watch-state';

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
    expect(handleWatchKey(at(0), ROWS, false, key('', { downArrow: true })).state.selected).toBe(1);
    expect(handleWatchKey(at(2), ROWS, false, key('j')).state.selected).toBe(2);
    expect(handleWatchKey(at(0), ROWS, false, key('k')).state.selected).toBe(0);
    expect(handleWatchKey(at(2), ROWS, false, key('', { upArrow: true })).state.selected).toBe(1);
  });

  it('quits on q and on Ctrl-C, in any mode', () => {
    expect(handleWatchKey(at(0), ROWS, false, key('q')).effect).toEqual({ kind: 'quit' });
    expect(handleWatchKey(at(0, { kind: 'deny' }), ROWS, false, key('c', { ctrl: true })).effect).toEqual({ kind: 'quit' });
  });

  it('never acts on a single key: a, d and r only open a confirmation', () => {
    for (const k of ['a', 'd', 'r']) {
      expect(handleWatchKey(at(0), ROWS, true, key(k)).effect).toBeUndefined();
    }
  });

  it('opens the approval on the preset nearest to the requested duration', () => {
    expect(handleWatchKey(at(0), ROWS, false, key('a')).state.mode).toEqual({ kind: 'approve', minutes: 60 });
    expect(handleWatchKey(at(1), ROWS, false, key('a')).state.mode).toEqual({ kind: 'approve', minutes: 240 });
    expect(handleWatchKey(at(2), ROWS, false, key('a')).state.mode).toEqual({ kind: 'approve', minutes: 30 });
  });

  it('ignores approve and deny with nothing selected, and revoke without an active grant', () => {
    expect(handleWatchKey(INITIAL_WATCH_STATE, [], false, key('a')).state.mode.kind).toBe('list');
    expect(handleWatchKey(INITIAL_WATCH_STATE, [], false, key('d')).state.mode.kind).toBe('list');
    expect(handleWatchKey(INITIAL_WATCH_STATE, ROWS, false, key('r')).state.mode.kind).toBe('list');
    expect(handleWatchKey(INITIAL_WATCH_STATE, ROWS, true, key('r')).state.mode.kind).toBe('revoke');
  });

  it('does not use a stale selection after the list shrank', () => {
    const result = handleWatchKey(at(9), ROWS, false, key('a'));
    expect(result.state.selected).toBe(2);
  });
});

describe('approve mode', () => {
  const approving = (minutes: number) => at(0, { kind: 'approve', minutes });

  it('cycles through the presets with the arrows, wrapping around', () => {
    const last = RDP_MINUTES_PRESETS[RDP_MINUTES_PRESETS.length - 1]!;
    const first = RDP_MINUTES_PRESETS[0]!;
    expect(handleWatchKey(approving(last), ROWS, false, key('', { rightArrow: true })).state.mode).toEqual({ kind: 'approve', minutes: first });
    expect(handleWatchKey(approving(first), ROWS, false, key('', { leftArrow: true })).state.mode).toEqual({ kind: 'approve', minutes: last });
  });

  it('approves only on Enter, with the chosen duration and the selected request', () => {
    expect(handleWatchKey(approving(120), ROWS, false, key('y')).effect).toBeUndefined();
    const result = handleWatchKey(at(1, { kind: 'approve', minutes: 120 }), ROWS, false, key('', { return: true }));
    expect(result.effect).toEqual({ kind: 'approve', requestId: 'bbbb', minutes: 120 });
    expect(result.state.mode.kind).toBe('list');
  });

  it('backs out with Escape or n and does nothing', () => {
    for (const k of [key('', { escape: true }), key('n')]) {
      const result = handleWatchKey(approving(60), ROWS, false, k);
      expect(result.effect).toBeUndefined();
      expect(result.state.mode.kind).toBe('list');
    }
  });
});

describe('deny and revoke modes', () => {
  it('act only on y', () => {
    expect(handleWatchKey(at(2, { kind: 'deny' }), ROWS, false, key('', { return: true })).effect).toBeUndefined();
    expect(handleWatchKey(at(2, { kind: 'deny' }), ROWS, false, key('y')).effect).toEqual({ kind: 'deny', requestId: 'cccc' });
    expect(handleWatchKey(at(0, { kind: 'revoke' }), ROWS, true, key('y')).effect).toEqual({ kind: 'revoke' });
  });

  it('cancel on Escape or n', () => {
    for (const mode of [{ kind: 'deny' }, { kind: 'revoke' }] as const) {
      const result = handleWatchKey(at(0, mode), ROWS, true, key('n'));
      expect(result.effect).toBeUndefined();
      expect(result.state.mode.kind).toBe('list');
    }
  });
});
