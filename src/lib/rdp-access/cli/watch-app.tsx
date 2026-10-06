import { Box, render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getActiveRdpGrant,
  listRdpRequests,
  nameMap,
  RdpQueryError,
  type RdpGrantSummary,
  type RdpRequestSummary,
} from '../queries';
import { cmdApprove, cmdDeny, cmdRevoke, EXIT, type CliContext, type ExitCode } from './commands';
import { clip, formatTime, shortId } from './format';
import { CLI_TEXT } from './text';
import {
  clampSelected,
  handleWatchKey,
  INITIAL_WATCH_STATE,
  type WatchEffect,
  type WatchState,
} from './watch-state';

// The interactive `watch` screen: pending requests refreshed on an interval, decided with single keys. It only
// renders and dispatches; the key rules live in watch-state.ts and every decision goes through the same
// cmdApprove / cmdDeny / cmdRevoke the plain commands use, so the checks and the audit trail are identical.
// The confirmation is the on-screen approve/deny/revoke prompt, so the commands are called with yes=true.

const LOG_LINES = 6;

type Snapshot = {
  rows: RdpRequestSummary[];
  names: Map<string, string>;
  grant: RdpGrantSummary | null;
  error: string | null;
};

const EMPTY: Snapshot = { rows: [], names: new Map(), grant: null, error: null };

function WatchApp({ ctx, intervalMs }: { ctx: CliContext; intervalMs: number }) {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [state, setState] = useState<WatchState>(INITIAL_WATCH_STATE);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const push = useCallback((line: string) => setLog((prev) => [...prev, line].slice(-LOG_LINES)), []);

  // One counter drives every refresh (the interval, and after each decision), so the data effect below only ever
  // sets state after its awaits.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const now = ctx.now();
        const [pending, grant] = await Promise.all([
          listRdpRequests(ctx.admin, { status: 'pending' }),
          getActiveRdpGrant(ctx.admin, now),
        ]);
        const rows = pending.filter((r) => Date.parse(r.expires_at) > now.getTime());
        const names = await nameMap(ctx.admin, [...rows.map((r) => r.requester_id), grant?.user_id ?? null]);
        if (cancelled) return;
        setSnapshot({ rows, names, grant, error: null });
        setState((prev) => ({ ...prev, selected: clampSelected(prev.selected, rows.length) }));
      } catch (error) {
        if (cancelled) return;
        const operation = error instanceof RdpQueryError ? error.operation : 'unexpected';
        setSnapshot((prev) => ({ ...prev, error: operation }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [ctx, tick]);

  // Same context as the plain commands, but output goes to the log area and the on-screen prompt is the confirmation.
  const actionCtx = useMemo<CliContext>(
    () => ({ ...ctx, out: push, err: push, confirm: () => Promise.resolve(true) }),
    [ctx, push],
  );

  const perform = useCallback(
    async (effect: Exclude<WatchEffect, { kind: 'quit' }>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        if (effect.kind === 'approve') {
          await cmdApprove(actionCtx, { id: effect.requestId, minutes: effect.minutes, note: '', yes: true });
        } else if (effect.kind === 'deny') {
          await cmdDeny(actionCtx, { id: effect.requestId, note: '', yes: true });
        } else {
          await cmdRevoke(actionCtx, { reason: '', yes: true });
        }
      } catch (error) {
        // Service and query errors carry the operation name only, so the message is safe to show.
        push(error instanceof Error ? error.message : CLI_TEXT.unexpected);
      } finally {
        busyRef.current = false;
        setBusy(false);
        refresh();
      }
    },
    [actionCtx, push, refresh],
  );

  useInput((input, key) => {
    const isCtrlC = key.ctrl && input === 'c';
    if (busyRef.current && !isCtrlC) return;
    const result = handleWatchKey(
      state,
      snapshot.rows.map((r) => ({ id: r.id, requestedMinutes: r.requested_minutes })),
      snapshot.grant !== null,
      { input, ...key },
    );
    setState(result.state);
    if (result.effect?.kind === 'quit') exit();
    else if (result.effect) void perform(result.effect);
  });

  const { rows, names, grant, error } = snapshot;
  const selected = clampSelected(state.selected, rows.length);
  const chosen = rows[selected];
  const nameOf = (id: string | null) => (id && names.get(id)) || '?';

  return (
    <Box flexDirection="column">
      <Text bold>גישת שולחן עבודה · בקשות ממתינות ({rows.length})</Text>
      <Text>
        {grant
          ? `גישה פעילה: ${nameOf(grant.user_id)} עד ${formatTime(grant.expires_at)}  קבצים ${grant.files_issued}/${grant.max_files}  (${shortId(grant.id)})`
          : CLI_TEXT.noActiveGrant}
      </Text>
      {error ? <Text color="red">{`הרענון נכשל (${error}), מנסה שוב`}</Text> : null}
      <Box flexDirection="column" marginY={1}>
        {rows.length === 0 ? (
          <Text dimColor>{CLI_TEXT.noPending}</Text>
        ) : (
          rows.map((r, index) => (
            <Text key={r.id} inverse={index === selected}>
              {`${shortId(r.id)}  ${nameOf(r.requester_id)}  ${r.requested_minutes}ד׳  ${formatTime(r.created_at)}  ${clip(r.reason, 50)}`}
            </Text>
          ))
        )}
      </Box>
      {chosen ? <Text dimColor>{`מטרה: ${chosen.reason}`}</Text> : null}
      {state.mode.kind === 'approve' ? (
        <Text color="yellow">{`לאשר ל-${nameOf(chosen?.requester_id ?? null)} ${state.mode.minutes} דקות?  ←/→ שינוי משך, Enter אישור, Esc ביטול`}</Text>
      ) : null}
      {state.mode.kind === 'deny' ? <Text color="yellow">{`${CLI_TEXT.confirmDeny}  y כן, Esc ביטול`}</Text> : null}
      {state.mode.kind === 'revoke' ? <Text color="red">{`${CLI_TEXT.confirmRevoke}  y כן, Esc ביטול`}</Text> : null}
      {busy ? <Text dimColor>מעבד…</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {log.map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
      </Box>
      <Text dimColor>↑/↓ בחירה · a אישור · d דחייה · r ביטול גישה פעילה · q יציאה</Text>
    </Box>
  );
}

/** Runs the screen until the owner quits. The caller guarantees an interactive terminal (ctx.host.isTTY). */
export async function runWatch(ctx: CliContext, intervalSeconds: number): Promise<ExitCode> {
  if (!ctx.host.isTTY) {
    ctx.err(CLI_TEXT.watchNeedsTty);
    return EXIT.error;
  }
  const app = render(<WatchApp ctx={ctx} intervalMs={intervalSeconds * 1000} />);
  await app.waitUntilExit();
  return EXIT.ok;
}
