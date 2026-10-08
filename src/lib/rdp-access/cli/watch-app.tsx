import { render, useApp, useInput, useStdout, useWindowSize } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  countRdpRequestsSince, getActiveRdpGrant, listRdpRequestExtras, listRdpRequests, listRecentRdpEvents, nameMap, RdpQueryError,
  type RdpGrantSummary, type RdpRequestExtras, type RdpRequestSummary,
} from '../queries';
import { cmdApprove, cmdDeny, cmdRevoke, EXIT, type CliContext, type ExitCode } from './commands';
import { WatchView, type ActivityLine } from './watch-view';
import { CLI_TEXT } from './text';
import { clock } from './format';
import { toHistoryLines, type HistoryLine } from './watch-data';
import {
  connectionRows, createSerialRunner, handleConnectionsKey, INITIAL_CONNECTIONS, INITIAL_CONNECTIONS_VIEW, nextConnectionsState,
  type ConnectionsState, type ConnectionsViewState,
} from './connections-state';
import { connectionDetailLines } from './watch-connections';
import {
  clampSelected, handleWatchKey, hasNewRequest, INITIAL_WATCH_STATE,
  type WatchEffect, type WatchState,
} from './watch-state';

const LOG_LINES = 5;
const HISTORY_EVENTS = 6;
const EXPIRED_WINDOW_MS = 24 * 3_600_000;
type Snapshot = {
  rows: RdpRequestSummary[]; names: Map<string, string>; grant: RdpGrantSummary | null; error: string | null; loadedAt: string | null;
  expired24h: number; extras: Map<string, RdpRequestExtras>; history: HistoryLine[];
};
const EMPTY: Snapshot = {
  rows: [], names: new Map(), grant: null, error: null, loadedAt: null,
  expired24h: 0, extras: new Map(), history: [],
};

function WatchApp({ ctx, intervalMs }: { ctx: CliContext; intervalMs: number }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // Ink's own hook: the window's size, and a re-render on every resize (it falls back to 80x24 when stdout is no TTY)
  const size = useWindowSize();
  const [inspecting, setInspecting] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [state, setState] = useState<WatchState>(INITIAL_WATCH_STATE);
  const [log, setLog] = useState<ActivityLine[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const snapshotRef = useRef(EMPTY);
  const [view, setView] = useState<'requests' | 'connections'>('requests');
  const [connections, setConnections] = useState<ConnectionsState>(INITIAL_CONNECTIONS);
  const [connectionNames, setConnectionNames] = useState<Map<string, string>>(new Map());
  const [connView, setConnView] = useState<ConnectionsViewState>(INITIAL_CONNECTIONS_VIEW);
  // a local clock for the countdowns of the connections view: a re-render each second, never a read of the database
  const [clockNow, setClockNow] = useState(() => ctx.now());
  const mountedRef = useRef(true);
  const push = useCallback((line: string) => setLog((prev) => [...prev, { time: clock(ctx.now()), message: line }].slice(-LOG_LINES)), [ctx]);

  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => {
    if (view !== 'connections') return;
    const timer = setInterval(() => setClockNow(ctx.now()), 1000);
    return () => clearInterval(timer);
  }, [ctx, view]);

  // The requests half and the connections half of a refresh are independent: the database failing must not hide what
  // the gateway says, and the gateway failing must not hide the requests.
  const loadRequests = useCallback(async (now: Date) => {
    try {
      const rows0 = await listRdpRequests(ctx.admin, { status: 'pending' });
      const [grant, events, expired24h] = await Promise.all([
        getActiveRdpGrant(ctx.admin, now),
        listRecentRdpEvents(ctx.admin, { limit: HISTORY_EVENTS }),
        countRdpRequestsSince(ctx.admin, { status: 'expired', since: new Date(now.getTime() - EXPIRED_WINDOW_MS) }),
      ]);
      const rows = rows0.filter((r) => Date.parse(r.expires_at) > now.getTime());
      const [names, extras] = await Promise.all([
        nameMap(ctx.admin, [...rows.map((r) => r.requester_id), grant?.user_id ?? null]),
        listRdpRequestExtras(ctx.admin, rows.map((r) => r.id)),
      ]);
      if (!mountedRef.current) return;
      const previous = snapshotRef.current;
      const previousIds = previous.loadedAt ? new Set(previous.rows.map((r) => r.id)) : null;
      if (hasNewRequest(previousIds, rows)) stdout.write('\x07');
      const next: Snapshot = {
        rows, names, grant, error: null, loadedAt: now.toISOString(), expired24h, extras, history: toHistoryLines(events, clock),
      };
      snapshotRef.current = next;
      setSnapshot(next);
      setState((prev) => {
        const previousId = previous.rows[prev.selected]?.id;
        const index = rows.findIndex((r) => r.id === previousId);
        const selected = index >= 0 ? index : clampSelected(prev.selected, rows.length);
        const mode = prev.mode;
        const requestGone = (mode.kind === 'approve' || mode.kind === 'deny') && !rows.some((r) => r.id === mode.requestId);
        const grantGone = mode.kind === 'revoke' && grant?.id !== mode.grantId;
        return { selected, mode: requestGone || grantGone ? { kind: 'list' } : mode };
      });
    } catch (error) {
      if (!mountedRef.current) return;
      const operation = error instanceof RdpQueryError ? error.operation : 'unexpected';
      setSnapshot((prev) => ({ ...prev, error: operation }));
      setState((prev) => ({ ...prev, mode: { kind: 'list' } }));
    }
  }, [ctx, stdout]);

  const loadGateway = useCallback(async (now: Date) => {
    const nowIso = now.toISOString();
    const gateway = ctx.api.getConfig(ctx.env);
    if (!gateway.ok) {
      setConnections((prev) => nextConnectionsState(prev, { gateway: 'unconfigured' }, nowIso));
      return;
    }
    try {
      const result = await ctx.api.connections(ctx.admin, () => ctx.api.listTunnels(gateway.config), now);
      const ids = result.gateway === 'ok' ? result.connections.flatMap((c) => [c.requesterId, c.approverId]) : [];
      // without names the screen shows short ids; it never invents a name
      const names = ids.length ? await nameMap(ctx.admin, ids).catch((error: unknown) => {
        if (error instanceof RdpQueryError) return new Map<string, string>();
        throw error;
      }) : new Map<string, string>();
      if (!mountedRef.current) return;
      setConnectionNames(names);
      setConnections((prev) => nextConnectionsState(prev, result, nowIso));
    } catch {
      if (!mountedRef.current) return;
      setSnapshot((prev) => ({ ...prev, error: 'connections' }));
    }
  }, [ctx]);

  // One refresh at a time: a timer tick that finds one running is dropped, a manual refresh runs right after it, and a
  // slow answer therefore can never land after, and overwrite, a newer one.
  const runnerRef = useRef<ReturnType<typeof createSerialRunner> | null>(null);
  useEffect(() => {
    const runner = createSerialRunner(async () => {
      const now = ctx.now();
      await Promise.all([loadRequests(now), loadGateway(now)]);
    });
    runnerRef.current = runner;
    runner.refresh();
    const timer = setInterval(runner.tick, intervalMs);
    return () => clearInterval(timer);
  }, [ctx, loadRequests, loadGateway, intervalMs]);
  const refresh = useCallback(() => runnerRef.current?.refresh(), []);

  const actionCtx = useMemo<CliContext>(
    () => ({ ...ctx, out: push, err: push, confirm: () => Promise.resolve(true) }), [ctx, push],
  );
  const perform = useCallback(async (effect: Exclude<WatchEffect, { kind: 'quit' }>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      let code: ExitCode;
      if (effect.kind === 'approve') {
        code = await cmdApprove(actionCtx, { id: effect.requestId, minutes: effect.minutes, note: '', yes: true });
      } else if (effect.kind === 'deny') {
        code = await cmdDeny(actionCtx, { id: effect.requestId, note: '', yes: true });
      } else {
        code = await cmdRevoke(actionCtx, { grantId: effect.grantId, reason: '', yes: true });
      }
      if (code !== EXIT.ok) push(`Action did not complete (exit ${code}). See command output above.`);
    } catch (error) {
      push(error instanceof Error ? error.message : CLI_TEXT.unexpected);
    } finally {
      busyRef.current = false;
      setBusy(false);
      refresh();
    }
  }, [actionCtx, push, refresh]);

  const connectionRowsNow = connectionRows(connections);
  const connectionIds = connectionRowsNow.map((r) => r.connection.tunnelId);
  const connectionNamesAll = useMemo(() => new Map([...snapshot.names, ...connectionNames]), [snapshot.names, connectionNames]);
  const selectedConnection = connectionRowsNow.find((r) => r.connection.tunnelId === connView.selectedId) ?? connectionRowsNow[0];

  useInput((rawInput, key) => {
    const input = rawInput.toLowerCase();
    if (view === 'connections') {
      // read-only view: it moves, opens details, refreshes, switches and quits; no key here acts on anything
      const lines = selectedConnection ? connectionDetailLines(selectedConnection, connections, connectionNamesAll, ctx.now()) : [];
      const result = handleConnectionsKey(connView, connectionIds, { ...key, input }, Math.max(0, lines.length - 1));
      setConnView(result.state);
      if (result.effect?.kind === 'quit') exit();
      else if (result.effect?.kind === 'refresh') refresh();
      else if (result.effect?.kind === 'switch') setView('requests');
      return;
    }
    if ((key.ctrl && input === 'c') || (input === 'q' && state.mode.kind === 'list')) { exit(); return; }
    if (busyRef.current) return;
    if ((key.tab || input === 'c') && state.mode.kind === 'list') { setView('connections'); setInspecting(false); return; }
    if ((input === 'r' || input === 'f') && state.mode.kind === 'list') { refresh(); return; }
    if (key.escape && inspecting) { setInspecting(false); return; }
    if ((input === 'i' || key.return) && state.mode.kind === 'list') { setInspecting((prev) => !prev); return; }
    if (snapshot.error || !snapshot.loadedAt) return;
    const now = ctx.now().getTime();
    const result = handleWatchKey(
      state,
      snapshot.rows.map((r) => ({ id: r.id, requestedMinutes: r.requested_minutes })),
      snapshot.grant && Date.parse(snapshot.grant.expires_at) > now ? snapshot.grant.id : null,
      { ...key, input: input === 'x' && state.mode.kind === 'list' ? 'r' : input },
    );
    // Check expiry on the keypress too, between polling intervals.
    if (result.effect && (result.effect.kind === 'approve' || result.effect.kind === 'deny')) {
      const effect = result.effect;
      const row = snapshot.rows.find((r) => r.id === effect.requestId);
      if (!row || Date.parse(row.expires_at) <= now) {
        setState({ selected: state.selected, mode: { kind: 'list' } });
        push('Request expired. Refreshing.'); refresh(); return;
      }
    }
    setState(result.state);
    if (result.effect?.kind === 'quit') exit();
    else if (result.effect) void perform(result.effect);
  });

  const { rows, grant, error } = snapshot;
  const selected = clampSelected(state.selected, rows.length);
  const mode = state.mode;
  const chosen = mode.kind === 'approve' || mode.kind === 'deny'
    ? rows.find((r) => r.id === mode.requestId) : rows[selected];
  const active = grant && Date.parse(grant.expires_at) > ctx.now().getTime() ? grant : null;
  const config = ctx.api.getConfig(ctx.env);
  return <WatchView
    columns={size.columns} terminalRows={size.rows} hostname={ctx.host.hostname}
    now={view === 'connections' ? clockNow : ctx.now()} requests={rows} names={connectionNamesAll} selected={selected} chosen={chosen}
    active={active} expired24h={snapshot.expired24h} extras={snapshot.extras} history={snapshot.history}
    view={view} connections={connections} connectionsView={connView}
    identity={config.ok ? config.config.gatewayUser : null} route={config.ok ? 'RD Gateway' : null}
    target={config.ok ? config.config.target : null} loaded={snapshot.loadedAt !== null}
    error={error} busy={busy} intervalSeconds={intervalMs / 1000}
    mode={mode} inspecting={inspecting} activity={log}
  />;

}

export async function runWatch(ctx: CliContext, intervalSeconds: number): Promise<ExitCode> {
  if (!ctx.host.isTTY) { ctx.err(CLI_TEXT.watchNeedsTty); return EXIT.error; }
  // alternateScreen: drawn in the terminal's second buffer like vim or htop, so the owner's scrollback is left alone and
  // every frame is exactly the window's size; the previous screen comes back on exit.
  const app = render(<WatchApp ctx={ctx} intervalMs={intervalSeconds * 1000} />, { alternateScreen: true });
  await app.waitUntilExit();
  return EXIT.ok;
}
