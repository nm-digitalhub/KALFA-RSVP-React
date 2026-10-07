import type { ConnectionDetail, ConnectionsSnapshot } from '../connections';
import type { WatchKey } from './watch-state';

// The state of the "connections" view of the watch screen, as pure functions: what the gateway last said, which
// connections have gone, what is selected, and what a key does there. The screen (watch-app.tsx) holds the state and
// draws it; nothing here touches a terminal, a database or the gateway.
//
// This view is read-only. No key here changes anything: it moves, opens details, refreshes, switches view or quits.

export type GoneConnection = { connection: ConnectionDetail; goneAt: string };

export type ConnectionsState = {
  /**
   * What the last attempt found out. `unknown` is before the first answer; `failed` and `unconfigured` mean the
   * gateway could not be asked (the list below is then the last one that WAS read, and is stale).
   */
  gateway: 'unknown' | 'ok' | 'failed' | 'unconfigured';
  /** `failed`: the gateway answered but the database did not, so the permissions of the connections are unavailable. */
  attribution: 'ok' | 'failed';
  /** The list from the last SUCCESSFUL gateway answer. */
  open: ConnectionDetail[];
  /** Connections that were in one successful answer and are missing from a later one. Newest first. */
  gone: GoneConnection[];
  /** When the gateway last answered successfully. */
  fetchedAt: string | null;
  /** When the last attempt that failed (gateway failed or not configured) happened. Cleared by a success. */
  failedAt: string | null;
};

export const INITIAL_CONNECTIONS: ConnectionsState = {
  gateway: 'unknown',
  attribution: 'ok',
  open: [],
  gone: [],
  fetchedAt: null,
  failedAt: null,
};

const MAX_GONE = 20;

/**
 * Folds one attempt into the state. A failed attempt changes nothing about what was seen: it must not turn "five
 * connections" into "none", and it must not make anything "gone" (it says nothing about what is open). Only a
 * successful answer can make a connection disappear.
 */
export function nextConnectionsState(
  previous: ConnectionsState,
  result: ConnectionsSnapshot | { gateway: 'unconfigured' },
  nowIso: string,
): ConnectionsState {
  if (result.gateway !== 'ok') return { ...previous, gateway: result.gateway, failedAt: nowIso };

  const currentIds = new Set(result.connections.map((c) => c.tunnelId));
  const vanished: GoneConnection[] =
    previous.fetchedAt === null ? [] : previous.open.filter((c) => !currentIds.has(c.tunnelId)).map((connection) => ({ connection, goneAt: nowIso }));
  // a connection that is listed again is not gone; a new one that vanished goes to the front
  const stillGone = previous.gone.filter((g) => !currentIds.has(g.connection.tunnelId));
  return {
    gateway: 'ok',
    attribution: result.attribution,
    open: result.connections,
    gone: [...vanished, ...stillGone].slice(0, MAX_GONE),
    fetchedAt: nowIso,
    failedAt: null,
  };
}

/** `open`: in the latest answer. `gone`: missing from a successful answer. `unknown`: the gateway could not be asked. */
export type ConnectionLink = 'open' | 'gone' | 'unknown';
export type ConnectionRow = { connection: ConnectionDetail; link: ConnectionLink; goneAt: string | null };

/** The rows the list shows: what is open (or last known, when the gateway cannot be asked), then what has gone. */
export function connectionRows(state: ConnectionsState): ConnectionRow[] {
  const link: ConnectionLink = state.gateway === 'ok' ? 'open' : 'unknown';
  return [
    ...state.open.map((connection): ConnectionRow => ({ connection, link, goneAt: null })),
    ...state.gone.map((g): ConnectionRow => ({ connection: g.connection, link: 'gone', goneAt: g.goneAt })),
  ];
}

// ── selection and keys ───────────────────────────────────────────────────────

export type ConnectionsViewState = { selectedId: string | null; details: boolean; scroll: number };
export const INITIAL_CONNECTIONS_VIEW: ConnectionsViewState = { selectedId: null, details: false, scroll: 0 };

/** The selection is kept by tunnel id, never by row position: a reordered or shorter list keeps the same connection. */
export function resolveSelection(ids: readonly string[], selectedId: string | null): string | null {
  if (ids.length === 0) return null;
  return selectedId !== null && ids.includes(selectedId) ? selectedId : ids[0]!;
}

export type ConnectionsEffect = { kind: 'quit' } | { kind: 'refresh' } | { kind: 'switch' };

export function handleConnectionsKey(
  state: ConnectionsViewState,
  ids: readonly string[],
  key: WatchKey,
  /** The most the open details can scroll, from the number of lines they have. */
  maxScroll: number,
): { state: ConnectionsViewState; effect?: ConnectionsEffect } {
  if (key.ctrl && key.input === 'c') return { state, effect: { kind: 'quit' } };
  if (key.input === 'q') return { state, effect: { kind: 'quit' } };
  if (key.input === 'r' || key.input === 'f') return { state, effect: { kind: 'refresh' } };
  if (key.tab || key.input === 'c') return { state: { ...state, details: false, scroll: 0 }, effect: { kind: 'switch' } };

  const selectedId = resolveSelection(ids, state.selectedId);
  const up = key.upArrow || key.input === 'k';
  const down = key.downArrow || key.input === 'j';

  if (state.details) {
    if (key.escape || key.return) return { state: { selectedId, details: false, scroll: 0 } };
    if (up) return { state: { selectedId, details: true, scroll: Math.max(0, state.scroll - 1) } };
    if (down) return { state: { selectedId, details: true, scroll: Math.min(Math.max(0, maxScroll), state.scroll + 1) } };
    return { state: { ...state, selectedId } };
  }

  if (key.return && selectedId !== null) return { state: { selectedId, details: true, scroll: 0 } };
  if ((up || down) && ids.length > 0) {
    const index = selectedId === null ? 0 : ids.indexOf(selectedId);
    const next = ids[Math.min(Math.max(index + (down ? 1 : -1), 0), ids.length - 1)]!;
    return { state: { ...state, selectedId: next } };
  }
  return { state: { ...state, selectedId } };
}

// ── one refresh at a time ────────────────────────────────────────────────────

/**
 * Runs `run` one at a time. A timer tick that finds one running is dropped (no overlapping calls); an explicit refresh
 * that finds one running is remembered and runs once right after it, however many times it was asked. Because runs
 * never overlap, a slow answer can never arrive after, and overwrite, a newer one.
 *
 * `run` must handle its own failures (the screen records them in its state): an error escaping it is not caught here.
 */
export function createSerialRunner(run: () => Promise<void>): { tick: () => void; refresh: () => void } {
  let running = false;
  let again = false;

  async function start(): Promise<void> {
    running = true;
    try {
      await run();
    } finally {
      running = false;
      if (again) {
        again = false;
        void start();
      }
    }
  }

  return {
    tick: () => {
      if (!running) void start();
    },
    refresh: () => {
      if (running) again = true;
      else void start();
    },
  };
}
