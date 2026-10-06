import { render, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  countRdpRequestsSince, getActiveRdpGrant, listRdpRequestExtras, listRdpRequests, listRecentRdpEvents, nameMap, RdpQueryError,
  type RdpGrantSummary, type RdpRequestExtras, type RdpRequestSummary,
} from '../queries';
import { cmdApprove, cmdDeny, cmdRevoke, EXIT, type CliContext, type ExitCode } from './commands';
import { WatchView, type ActivityLine } from './watch-view';
import { CLI_TEXT } from './text';
import { liveConnections, terminalSize, toHistoryLines, type HistoryLine, type LiveConnections } from './watch-data';
import {
  clampSelected, handleWatchKey, hasNewRequest, INITIAL_WATCH_STATE,
  type WatchEffect, type WatchState,
} from './watch-state';

const LOG_LINES = 5;
const HISTORY_EVENTS = 6;
const EXPIRED_WINDOW_MS = 24 * 3_600_000;
const FALLBACK_SIZE = { columns: 100, rows: 40 };
type Snapshot = {
  rows: RdpRequestSummary[]; names: Map<string, string>; grant: RdpGrantSummary | null; error: string | null; loadedAt: string | null;
  expired24h: number; extras: Map<string, RdpRequestExtras>; history: HistoryLine[]; live: LiveConnections;
};
const EMPTY: Snapshot = {
  rows: [], names: new Map(), grant: null, error: null, loadedAt: null,
  expired24h: 0, extras: new Map(), history: [], live: { known: false },
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false });

function WatchApp({ ctx, intervalMs }: { ctx: CliContext; intervalMs: number }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => terminalSize(stdout, FALLBACK_SIZE));
  const [inspecting, setInspecting] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [state, setState] = useState<WatchState>(INITIAL_WATCH_STATE);
  const [log, setLog] = useState<ActivityLine[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const snapshotRef = useRef(EMPTY);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const push = useCallback((line: string) => setLog((prev) => [...prev, { time: ctx.now().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false }), message: line }].slice(-LOG_LINES)), [ctx]);

  useEffect(() => {
    const resize = () => setSize(terminalSize(stdout, FALLBACK_SIZE));
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  useEffect(() => {
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const now = ctx.now();
        const gateway = ctx.api.getConfig(ctx.env);
        const [pending, grant, events, expired24h, tunnels] = await Promise.all([
          listRdpRequests(ctx.admin, { status: 'pending' }),
          getActiveRdpGrant(ctx.admin, now),
          listRecentRdpEvents(ctx.admin, { limit: HISTORY_EVENTS }),
          countRdpRequestsSince(ctx.admin, { status: 'expired', since: new Date(now.getTime() - EXPIRED_WINDOW_MS) }),
          // not being able to ask the gateway is a state to show (LIVE --), never a reason to stop the screen
          gateway.ok ? ctx.api.listTunnels(gateway.config) : Promise.resolve(null),
        ]);
        const rows = pending.filter((r) => Date.parse(r.expires_at) > now.getTime());
        const [names, extras] = await Promise.all([
          nameMap(ctx.admin, [...rows.map((r) => r.requester_id), grant?.user_id ?? null]),
          listRdpRequestExtras(ctx.admin, rows.map((r) => r.id)),
        ]);
        if (cancelled) return;
        const previous = snapshotRef.current;
        const previousIds = previous.loadedAt ? new Set(previous.rows.map((r) => r.id)) : null;
        if (hasNewRequest(previousIds, rows)) stdout.write('\x07');
        const next: Snapshot = {
          rows, names, grant, error: null, loadedAt: now.toISOString(), expired24h, extras,
          history: toHistoryLines(events, clock), live: liveConnections(tunnels),
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
        if (cancelled) return;
        const operation = error instanceof RdpQueryError ? error.operation : 'unexpected';
        setSnapshot((prev) => ({ ...prev, error: operation }));
        setState((prev) => ({ ...prev, mode: { kind: 'list' } }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [ctx, tick, stdout]);

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

  useInput((rawInput, key) => {
    const input = rawInput.toLowerCase();
    if ((key.ctrl && input === 'c') || (input === 'q' && state.mode.kind === 'list')) { exit(); return; }
    if (busyRef.current) return;
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

  const { rows, names, grant, error } = snapshot;
  const selected = clampSelected(state.selected, rows.length);
  const mode = state.mode;
  const chosen = mode.kind === 'approve' || mode.kind === 'deny'
    ? rows.find((r) => r.id === mode.requestId) : rows[selected];
  const active = grant && Date.parse(grant.expires_at) > ctx.now().getTime() ? grant : null;
  const config = ctx.api.getConfig(ctx.env);
  return <WatchView
    columns={size.columns} terminalRows={size.rows} hostname={ctx.host.hostname}
    now={ctx.now()} requests={rows} names={names} selected={selected} chosen={chosen}
    active={active} expired24h={snapshot.expired24h} extras={snapshot.extras} live={snapshot.live} history={snapshot.history}
    identity={config.ok ? config.config.gatewayUser : null} route={config.ok ? 'RD Gateway' : null}
    target={config.ok ? config.config.target : null} loaded={snapshot.loadedAt !== null}
    error={error} busy={busy} intervalSeconds={intervalMs / 1000}
    mode={mode} inspecting={inspecting} activity={log}
  />;

}

export async function runWatch(ctx: CliContext, intervalSeconds: number): Promise<ExitCode> {
  if (!ctx.host.isTTY) { ctx.err(CLI_TEXT.watchNeedsTty); return EXIT.error; }
  const app = render(<WatchApp ctx={ctx} intervalMs={intervalSeconds * 1000} />);
  await app.waitUntilExit();
  return EXIT.ok;
}
