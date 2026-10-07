import { describe, expect, it, vi } from 'vitest';

import type { ConnectionDetail, ConnectionsSnapshot } from '../connections';
import {
  connectionRows,
  createSerialRunner,
  handleConnectionsKey,
  INITIAL_CONNECTIONS,
  INITIAL_CONNECTIONS_VIEW,
  nextConnectionsState,
  resolveSelection,
  type ConnectionsViewState,
} from './connections-state';

function conn(id: string, over: Partial<ConnectionDetail> = {}): ConnectionDetail {
  return {
    tunnelId: id, gatewayUser: 'desktopuser', clientIp: '198.51.100.20', target: 'h:3389', connectedOn: '2026-10-07T00:10:00.000Z',
    attribution: 'attributed', grantId: 'g', requestId: 'r', permission: 'active', grantStartsAt: 'x', grantExpiresAt: 'y', grantEndedAt: null,
    reason: null, requesterId: null, approverId: null, requestIp: null, requestedMinutes: null, grantedMinutes: null, tunnelsOpened: 1,
    cut: 'not_needed', cutError: null, filesIssued: 0, maxFiles: 20, ...over,
  };
}
const ok = (...connections: ConnectionDetail[]): ConnectionsSnapshot => ({ gateway: 'ok', attribution: 'ok', connections });
const T = (n: number) => `2026-10-07T00:00:${String(n).padStart(2, '0')}.000Z`;

describe('nextConnectionsState', () => {
  it('records a successful answer, including a successful empty one', () => {
    const state = nextConnectionsState(INITIAL_CONNECTIONS, ok(), T(1));
    expect(state).toMatchObject({ gateway: 'ok', open: [], gone: [], fetchedAt: T(1), failedAt: null });
  });

  it('turns a connection that is missing from a later successful answer into a gone one', () => {
    const first = nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('a'), conn('b')), T(1));
    const second = nextConnectionsState(first, ok(conn('b')), T(2));
    expect(second.open.map((c) => c.tunnelId)).toEqual(['b']);
    expect(second.gone).toEqual([{ connection: conn('a'), goneAt: T(2) }]);
  });

  it('does not call anything gone after the very first answer, which has nothing to compare with', () => {
    expect(nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('a')), T(1)).gone).toEqual([]);
  });

  it('keeps what it saw when the gateway fails: no connection becomes gone, none becomes "zero"', () => {
    const seen = nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('a')), T(1));
    const failed = nextConnectionsState(seen, { gateway: 'failed' }, T(2));
    expect(failed).toMatchObject({ gateway: 'failed', fetchedAt: T(1), failedAt: T(2), gone: [] });
    expect(failed.open.map((c) => c.tunnelId)).toEqual(['a']);
    // and the next successful answer still compares against the last successful one
    const back = nextConnectionsState(failed, ok(), T(3));
    expect(back.gone.map((g) => g.connection.tunnelId)).toEqual(['a']);
    expect(back.failedAt).toBeNull();
  });

  it('keeps what it saw when the gateway is not configured', () => {
    const seen = nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('a')), T(1));
    expect(nextConnectionsState(seen, { gateway: 'unconfigured' }, T(2))).toMatchObject({ gateway: 'unconfigured', fetchedAt: T(1) });
  });

  it('drops a gone entry whose tunnel id is listed again', () => {
    let state = nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('a')), T(1));
    state = nextConnectionsState(state, ok(), T(2));
    expect(state.gone).toHaveLength(1);
    state = nextConnectionsState(state, ok(conn('a')), T(3));
    expect(state.gone).toEqual([]);
  });

  it('shows a reconnect as a new connection next to the gone one, newest gone first', () => {
    let state = nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('old1')), T(1));
    state = nextConnectionsState(state, ok(conn('new1')), T(2));
    state = nextConnectionsState(state, ok(conn('new2')), T(3));
    expect(state.open.map((c) => c.tunnelId)).toEqual(['new2']);
    expect(state.gone.map((g) => g.connection.tunnelId)).toEqual(['new1', 'old1']);
  });

  it('keeps the database failure visible while the connections stay known', () => {
    const state = nextConnectionsState(INITIAL_CONNECTIONS, { gateway: 'ok', attribution: 'failed', connections: [conn('a', { attribution: 'unavailable' })] }, T(1));
    expect(state).toMatchObject({ gateway: 'ok', attribution: 'failed' });
    expect(state.open[0]!.attribution).toBe('unavailable');
  });

  it('keeps at most twenty gone entries', () => {
    let state = INITIAL_CONNECTIONS;
    for (let i = 0; i < 30; i += 1) {
      state = nextConnectionsState(state, ok(conn(`t${i}`)), T(i));
    }
    state = nextConnectionsState(state, ok(), T(40));
    expect(state.gone.length).toBeLessThanOrEqual(20);
  });
});

describe('connectionRows', () => {
  it('lists the open ones first, then the gone ones', () => {
    let state = nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('a'), conn('b')), T(1));
    state = nextConnectionsState(state, ok(conn('b')), T(2));
    expect(connectionRows(state).map((r) => [r.connection.tunnelId, r.link])).toEqual([['b', 'open'], ['a', 'gone']]);
  });

  it('marks the last known connections as unknown, not open, while the gateway cannot be asked', () => {
    const seen = nextConnectionsState(INITIAL_CONNECTIONS, ok(conn('a')), T(1));
    const failed = nextConnectionsState(seen, { gateway: 'failed' }, T(2));
    expect(connectionRows(failed).map((r) => r.link)).toEqual(['unknown']);
  });
});

describe('selection', () => {
  it('keeps the same connection when the list is reordered or shrinks, and falls back to the first only when it is gone', () => {
    expect(resolveSelection(['a', 'b', 'c'], 'b')).toBe('b');
    expect(resolveSelection(['c', 'b', 'a'], 'b')).toBe('b');
    expect(resolveSelection(['a', 'c'], 'b')).toBe('a');
    expect(resolveSelection([], 'b')).toBeNull();
    expect(resolveSelection(['a'], null)).toBe('a');
  });
});

describe('handleConnectionsKey', () => {
  const ids = ['a', 'b', 'c'];
  const at = (selectedId: string | null, extra: Partial<ConnectionsViewState> = {}): ConnectionsViewState => ({ ...INITIAL_CONNECTIONS_VIEW, selectedId, ...extra });

  it('moves the selection by tunnel id with the arrows and with j/k, never past the ends', () => {
    expect(handleConnectionsKey(at('a'), ids, { input: '', downArrow: true }, 0).state.selectedId).toBe('b');
    expect(handleConnectionsKey(at('c'), ids, { input: 'j' }, 0).state.selectedId).toBe('c');
    expect(handleConnectionsKey(at('b'), ids, { input: '', upArrow: true }, 0).state.selectedId).toBe('a');
    expect(handleConnectionsKey(at('a'), ids, { input: 'k' }, 0).state.selectedId).toBe('a');
  });

  it('starts from the first connection when nothing is selected', () => {
    expect(handleConnectionsKey(at(null), ids, { input: '', downArrow: true }, 0).state.selectedId).toBe('b');
  });

  it('opens the details with Enter and closes them with Enter or Escape', () => {
    const opened = handleConnectionsKey(at('b'), ids, { input: '', return: true }, 0);
    expect(opened.state).toEqual({ selectedId: 'b', details: true, scroll: 0 });
    expect(handleConnectionsKey(opened.state, ids, { input: '', escape: true }, 0).state).toEqual({ selectedId: 'b', details: false, scroll: 0 });
    expect(handleConnectionsKey(opened.state, ids, { input: '', return: true }, 0).state.details).toBe(false);
  });

  it('opens nothing when there is nothing to open', () => {
    expect(handleConnectionsKey(at(null), [], { input: '', return: true }, 0).state.details).toBe(false);
  });

  it('scrolls the open details instead of moving the selection, within bounds', () => {
    const open = at('b', { details: true, scroll: 0 });
    expect(handleConnectionsKey(open, ids, { input: '', downArrow: true }, 5).state).toEqual({ selectedId: 'b', details: true, scroll: 1 });
    expect(handleConnectionsKey({ ...open, scroll: 5 }, ids, { input: '', downArrow: true }, 5).state.scroll).toBe(5);
    expect(handleConnectionsKey(open, ids, { input: '', upArrow: true }, 5).state.scroll).toBe(0);
  });

  it('refreshes, switches view and quits, and Ctrl-C quits too', () => {
    expect(handleConnectionsKey(at('a'), ids, { input: 'r' }, 0).effect).toEqual({ kind: 'refresh' });
    expect(handleConnectionsKey(at('a'), ids, { input: 'f' }, 0).effect).toEqual({ kind: 'refresh' });
    expect(handleConnectionsKey(at('a'), ids, { input: '', tab: true }, 0).effect).toEqual({ kind: 'switch' });
    expect(handleConnectionsKey(at('a'), ids, { input: 'c' }, 0).effect).toEqual({ kind: 'switch' });
    expect(handleConnectionsKey(at('a'), ids, { input: 'q' }, 0).effect).toEqual({ kind: 'quit' });
    expect(handleConnectionsKey(at('a'), ids, { input: 'c', ctrl: true }, 0).effect).toEqual({ kind: 'quit' });
  });

  it('has no key that acts: approve, deny and revoke do nothing here', () => {
    for (const input of ['a', 'd', 'x', 'y', 'n']) {
      const result = handleConnectionsKey(at('b'), ids, { input }, 0);
      expect(result.effect).toBeUndefined();
      expect(result.state).toEqual(at('b'));
    }
  });
});

describe('createSerialRunner', () => {
  function gate() {
    const resolvers: Array<() => void> = [];
    const run = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    return { run, finish: () => resolvers.shift()?.(), pending: () => resolvers.length };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('drops a timer tick that finds a run in flight, so calls never overlap', async () => {
    const g = gate();
    const runner = createSerialRunner(g.run);
    runner.tick();
    runner.tick();
    runner.tick();
    expect(g.run).toHaveBeenCalledTimes(1);
    g.finish();
    await flush();
    runner.tick();
    expect(g.run).toHaveBeenCalledTimes(2);
  });

  it('runs an explicit refresh once right after the run in flight, however many times it was asked', async () => {
    const g = gate();
    const runner = createSerialRunner(g.run);
    runner.tick();
    runner.refresh();
    runner.refresh();
    runner.refresh();
    expect(g.run).toHaveBeenCalledTimes(1);
    g.finish();
    await flush();
    expect(g.run).toHaveBeenCalledTimes(2);
    g.finish();
    await flush();
    expect(g.run).toHaveBeenCalledTimes(2);
  });

  it('starts an explicit refresh at once when nothing is running', () => {
    const g = gate();
    createSerialRunner(g.run).refresh();
    expect(g.run).toHaveBeenCalledTimes(1);
  });

  it('applies results in the order the runs started, so a slow answer cannot overwrite a newer one', async () => {
    const applied: number[] = [];
    let n = 0;
    const resolvers: Array<() => void> = [];
    const runner = createSerialRunner(async () => {
      const mine = ++n;
      await new Promise<void>((resolve) => resolvers.push(resolve));
      applied.push(mine);
    });
    runner.tick();
    runner.refresh();
    resolvers.shift()?.(); // the first run answers (late)
    await flush();
    resolvers.shift()?.(); // the second answers after it
    await flush();
    expect(applied).toEqual([1, 2]);
  });
});
