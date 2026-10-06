import { RDP_MINUTES_PRESETS } from '../policy';

// The key handling of the interactive `watch` screen, as a pure function so the screen (watch-app.tsx) stays a
// thin renderer and the behavior can be tested without a terminal.
//
// Nothing is decided on a single key: approve opens a duration choice that must be confirmed with Enter, and deny
// and revoke ask for `y`. Escape backs out of any of them.

export type WatchMode =
  | { kind: 'list' }
  | { kind: 'approve'; minutes: number }
  | { kind: 'deny' }
  | { kind: 'revoke' };

export type WatchState = { selected: number; mode: WatchMode };

export type WatchRow = { id: string; requestedMinutes: number };

export type WatchKey = {
  input: string;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
};

export type WatchEffect =
  | { kind: 'approve'; requestId: string; minutes: number }
  | { kind: 'deny'; requestId: string }
  | { kind: 'revoke' }
  | { kind: 'quit' };

export const INITIAL_WATCH_STATE: WatchState = { selected: 0, mode: { kind: 'list' } };

export function clampSelected(selected: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(selected, 0), length - 1);
}

/** The preset closest to what was asked for, so the confirm screen opens on the requester's choice. */
function nearestPreset(minutes: number): number {
  return RDP_MINUTES_PRESETS.reduce((best, p) => (Math.abs(p - minutes) < Math.abs(best - minutes) ? p : best));
}

function cyclePreset(current: number, step: 1 | -1): number {
  const index = RDP_MINUTES_PRESETS.findIndex((p) => p === current);
  const next = (index + step + RDP_MINUTES_PRESETS.length) % RDP_MINUTES_PRESETS.length;
  return RDP_MINUTES_PRESETS[next]!;
}

export function handleWatchKey(
  state: WatchState,
  rows: readonly WatchRow[],
  hasActiveGrant: boolean,
  key: WatchKey,
): { state: WatchState; effect?: WatchEffect } {
  if (key.ctrl && key.input === 'c') return { state, effect: { kind: 'quit' } };

  const { mode } = state;
  const selected = clampSelected(state.selected, rows.length);
  const row = rows[selected];

  if (mode.kind === 'list') {
    if (key.input === 'q') return { state, effect: { kind: 'quit' } };
    if (key.upArrow || key.input === 'k') return { state: { ...state, selected: clampSelected(selected - 1, rows.length) } };
    if (key.downArrow || key.input === 'j') return { state: { ...state, selected: clampSelected(selected + 1, rows.length) } };
    if (key.input === 'a' && row) {
      return { state: { selected, mode: { kind: 'approve', minutes: nearestPreset(row.requestedMinutes) } } };
    }
    if (key.input === 'd' && row) return { state: { selected, mode: { kind: 'deny' } } };
    if (key.input === 'r' && hasActiveGrant) return { state: { selected, mode: { kind: 'revoke' } } };
    return { state };
  }

  if (key.escape || key.input === 'n') return { state: { selected, mode: { kind: 'list' } } };

  if (mode.kind === 'approve') {
    if (key.leftArrow) return { state: { selected, mode: { kind: 'approve', minutes: cyclePreset(mode.minutes, -1) } } };
    if (key.rightArrow) return { state: { selected, mode: { kind: 'approve', minutes: cyclePreset(mode.minutes, 1) } } };
    if (key.return && row) {
      return { state: { selected, mode: { kind: 'list' } }, effect: { kind: 'approve', requestId: row.id, minutes: mode.minutes } };
    }
    return { state };
  }

  if (key.input === 'y') {
    if (mode.kind === 'deny' && row) {
      return { state: { selected, mode: { kind: 'list' } }, effect: { kind: 'deny', requestId: row.id } };
    }
    if (mode.kind === 'revoke') return { state: { selected, mode: { kind: 'list' } }, effect: { kind: 'revoke' } };
  }
  return { state };
}
