import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import { useRef, type ReactNode } from 'react';
import type { RdpGrantSummary, RdpRequestExtras, RdpRequestSummary } from '../queries';
import type { HistoryLine, LiveConnections } from './watch-data';
import type { WatchMode } from './watch-state';

// The layout is Ink's own: the screen is as big as the window (useWindowSize, in watch-app), flexbox gives every part
// its share, `overflow="hidden"` clips what does not fit, and `wrap="truncate"` cuts a line at the edge instead of
// breaking it. Nothing here counts lines. The only decisions are the few breakpoints below.
const MIN_COLUMNS = 40; // under this (or MIN_ROWS) the screen says so instead of drawing something broken
const MIN_ROWS = 16;
const WIDE_COLUMNS = 95; // list and details side by side from here; narrower, the details open on Enter
const ROUTE_COLUMNS = 70; // the route column of the list from here
const COMPACT_ROWS = 32; // shorter than this, the activity box and the hint line give way to one line

const C = { bg: '#101418', selected: '#382019', orange: '#FF5A3C', text: '#E6E8EB', muted: '#9AA4AF', border: '#56606A' };
const BORDER = { topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+', top: '-', bottom: '-', left: '|', right: '|' };
export type ActivityLine = { time: string; message: string };
export type WatchViewProps = {
  columns: number; terminalRows: number; hostname: string; now: Date;
  requests: RdpRequestSummary[]; names: Map<string, string>; selected: number;
  chosen: RdpRequestSummary | undefined; active: RdpGrantSummary | null;
  /** Requests that ended unanswered in the last 24 hours (counted in the database, not guessed from this page). */
  expired24h: number;
  /** The address each pending request came from, as recorded when it was made. */
  extras: Map<string, RdpRequestExtras>;
  /** What the gateway holds open right now. Unknown when the gateway could not be asked. */
  live: LiveConnections;
  /** The newest audit events across every request (from the database), oldest first. */
  history: HistoryLine[];
  /** The account the gateway signs in as (NOT the requester), and the way in. Null when the gateway is not configured. */
  identity: string | null; route: string | null;
  target: string | null; loaded: boolean; error: string | null;
  busy: boolean; intervalSeconds: number; mode: WatchMode; inspecting: boolean;
  /** Results of what was done from THIS screen since it opened. */
  activity: ActivityLine[];
};

function time(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}
function short(id: string): string { return id.slice(0, 8); }
function wait(created: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(created)) / 1000));
  if (!Number.isFinite(seconds)) return '-';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, ' ');

function Rule() {
  // a rule is a border: it is as wide as the box it sits in, whatever that is
  return <Box borderStyle={BORDER} borderTop={false} borderLeft={false} borderRight={false} borderColor={C.border} height={1} flexShrink={0} />;
}
function Row({ label, value }: { label: string; value: string }) {
  return <Box flexShrink={0}><Box width={14} flexShrink={0}><Text color={C.muted}>{label}</Text></Box><Box flexGrow={1} flexShrink={1}><Text color={C.text} wrap="truncate">{value}</Text></Box></Box>;
}
function Panel({ children, ...style }: { children: ReactNode; width?: string | number; flexGrow?: number }) {
  return <Box {...style} flexShrink={1} overflow="hidden" flexDirection="column" borderStyle={BORDER} borderColor={C.border} borderBackgroundColor={C.bg} paddingX={1}>
    {children}
  </Box>;
}

type ListProps = Pick<WatchViewProps, 'requests' | 'names' | 'selected' | 'now' | 'loaded' | 'route'> & { showRoute: boolean };

/** The request rows, in a box that clips and scrolls: the visible height is measured, not computed. */
function RequestList(p: ListProps) {
  const ref = useRef<DOMElement>(null);
  const { height, hasMeasured } = useBoxMetrics(ref);
  // keep the selected row inside the window: scroll just far enough
  const offset = hasMeasured ? Math.max(0, p.selected + 1 - height) : 0;
  const nameOf = (id: string | null) => (id ? p.names.get(id) || short(id) : '-');
  return <Box ref={ref} flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
    <Box flexDirection="column" flexShrink={0} contentOffsetY={offset}>
      {p.requests.length ? p.requests.map((r, i) => {
        const selected = i === p.selected;
        return <Box key={r.id} height={1} flexShrink={0} backgroundColor={selected ? C.selected : C.bg}>
          <Box width={2} flexShrink={0}><Text color={selected ? C.orange : C.text}>{selected ? '>' : ' '}</Text></Box>
          <Box width={9} flexShrink={0}><Text color={selected ? C.orange : C.text}>{short(r.id)}</Text></Box>
          <Box flexGrow={1} flexShrink={1}><Text color={selected ? C.orange : C.text} wrap="truncate">{nameOf(r.requester_id)}</Text></Box>
          {p.showRoute ? <Box width={11} flexShrink={0}><Text color={selected ? C.orange : C.text} wrap="truncate">{p.route ?? '-'}</Text></Box> : null}
          <Box width={5} flexShrink={0}><Text color={selected ? C.orange : C.text}>{wait(r.created_at, p.now)}</Text></Box>
        </Box>;
      }) : <Text color={C.muted}>{p.loaded ? 'No pending requests.' : 'Loading requests...'}</Text>}
    </Box>
  </Box>;
}

function TooSmall({ columns, rows }: { columns: number; rows: number }) {
  return <Box flexDirection="column" backgroundColor={C.bg} width={Math.max(1, columns - 1)} height={Math.max(1, rows - 1)} overflow="hidden">
    <Text bold color={C.orange} wrap="truncate">KALFA / RDP ACCESS</Text>
    <Text color={C.text} wrap="truncate">Terminal too small.</Text>
    <Text color={C.muted} wrap="truncate">{`${columns}x${rows}, need ${MIN_COLUMNS}x${MIN_ROWS}`}</Text>
    <Text color={C.muted} wrap="truncate">Resize it, or press Q to quit.</Text>
  </Box>;
}

/** Presentation only. Commands, approval policy and gateway behavior remain in the existing modules. */
export function WatchView(p: WatchViewProps) {
  if (p.columns < MIN_COLUMNS || p.terminalRows < MIN_ROWS) return <TooSmall columns={p.columns} rows={p.terminalRows} />;

  const wide = p.columns >= WIDE_COLUMNS;
  const compact = p.terminalRows < COMPACT_ROWS;
  const nameOf = (id: string | null) => (id ? p.names.get(id) || short(id) : '-');
  const status = p.error ? 'OFFLINE' : p.busy ? 'WORKING' : p.loaded ? 'LIVE' : 'LOADING';
  const count = (n: number) => String(n).padStart(2, '0');
  const pending = p.loaded ? count(p.requests.length) : '--';
  const grant = p.loaded ? count(p.active ? 1 : 0) : '--';
  const live = p.loaded && p.live.known ? count(p.live.count) : '--';
  const expired = p.loaded ? count(p.expired24h) : '--';

  const chosen = p.chosen;
  const requestIp = chosen ? (p.extras.get(chosen.id)?.requestIp ?? 'Not recorded') : '';
  // the most useful first: when the panel is short, the clipping takes the last ones
  const fields: Array<[string, string]> = chosen ? [
    ['Request', short(chosen.id)],
    ['Requester', nameOf(chosen.requester_id)],
    ['Request IP', requestIp],
    ['Duration', `${chosen.requested_minutes} minutes`],
    ['Target', p.target || '-'],
    ['Gateway user', p.identity ?? 'Gateway not configured'],
    ['Route', p.route ?? 'Gateway not configured'],
    ['Requested', time(chosen.created_at)],
  ] : [];

  const sessionLine = p.activity.length ? p.activity[p.activity.length - 1] : undefined;
  const lastHistory = p.history.length ? p.history[p.history.length - 1] : undefined;
  const sessionText = sessionLine ? `${sessionLine.time}  CLI  ${sessionLine.message}` : null;
  const activeText = p.active
    ? `Active: ${nameOf(p.active.user_id)} until ${time(p.active.expires_at)} | Files ${p.active.files_issued}/${p.active.max_files}${p.live.known ? ` | Live ${p.live.count}${p.live.tunnels[0] ? ` from ${p.live.tunnels[0].clientIp} since ${time(p.live.tunnels[0].connectedOn)}` : ''}` : ' | Live unknown'}`
    : null;
  const emptyHistory = p.loaded ? 'No access events yet.' : 'Loading activity...';
  const prompt =
    p.mode.kind === 'approve' ? `Approve ${short(p.mode.requestId)} for ${p.mode.minutes} min? Left/Right duration | Enter confirm | Esc cancel`
    : p.mode.kind === 'deny' ? `Deny ${short(p.mode.requestId)}? [Y] Confirm | Esc cancel`
    : p.mode.kind === 'revoke' ? `Revoke ${short(p.mode.grantId)} and disconnect? [Y] Confirm | Esc cancel`
    : p.error ? `Refresh failed (${p.error}). Decisions paused. [R] Retry.`
    : null;
  const summary = chosen
    ? `${short(chosen.id)}  ${nameOf(chosen.requester_id)}  ${requestIp}  ${chosen.requested_minutes} min  (Enter: details)`
    : 'Select a request. Enter shows its details.';

  const list = <Panel flexGrow={1}>
    <Text bold color={C.orange}>ACCESS REQUESTS</Text>
    <Box height={1} flexShrink={0}>
      <Box width={11} flexShrink={0}><Text bold color={C.muted}>ID</Text></Box>
      <Box flexGrow={1}><Text bold color={C.muted}>USER</Text></Box>
      {p.columns >= ROUTE_COLUMNS ? <Box width={11} flexShrink={0}><Text bold color={C.muted}>ROUTE</Text></Box> : null}
      <Box width={5} flexShrink={0}><Text bold color={C.muted}>WAIT</Text></Box>
    </Box>
    <Rule />
    <RequestList requests={p.requests} names={p.names} selected={p.selected} now={p.now} loaded={p.loaded} route={p.route} showRoute={p.columns >= ROUTE_COLUMNS} />
  </Panel>;

  const details = <Panel {...(wide ? { width: '39%' } : { flexGrow: 1 })}>
    <Text bold color={C.orange}>REQUEST DETAILS</Text>
    {chosen ? <>
      {fields.map(([label, value]) => <Row key={label} label={label} value={value} />)}
      <Rule />
      <Text color={C.muted} wrap={p.inspecting ? 'wrap' : 'truncate'}>{oneLine(chosen.reason)}</Text>
    </> : <>
      <Text color={C.muted}>Select a request to review.</Text>
      <Rule />
      <Text color={C.muted}>Approval grants temporary access.</Text>
      <Text color={C.muted}>Linux sign-in is still required.</Text>
    </>}
  </Panel>;

  return <Box width={p.columns - 1} height={p.terminalRows - 1} overflow="hidden" flexDirection="column" backgroundColor={C.bg} paddingX={1}>
    <Box flexDirection="column" borderStyle={BORDER} borderColor={C.border} borderBackgroundColor={C.bg} paddingX={1} flexShrink={0}>
      <Box justifyContent="space-between" columnGap={2}>
        <Text bold wrap="truncate"><Text color={C.orange}>KALFA</Text><Text color={C.text}> / RDP ACCESS</Text></Text>
        <Text color={C.muted} wrap="truncate">{p.hostname}  <Text bold color={C.orange}>{status}</Text></Text>
      </Box>
      <Box columnGap={3} flexWrap="wrap">
        <Text bold color={C.muted}>PENDING <Text color={C.orange}>{pending}</Text></Text>
        <Text bold color={C.muted}>GRANT <Text color={C.text}>{grant}</Text></Text>
        <Text bold color={C.muted}>LIVE <Text color={C.text}>{live}</Text></Text>
        <Text bold color={C.muted}>EXPIRED 24H <Text color={C.text}>{expired}</Text></Text>
      </Box>
    </Box>

    <Box flexGrow={1} flexShrink={1} overflow="hidden" marginTop={1} flexDirection={wide ? 'row' : 'column'} columnGap={1}>
      {wide ? <>{list}{details}</>
        : p.inspecting ? details
        : <>{list}<Box flexShrink={0}><Text color={C.muted} wrap="truncate">{summary}</Text></Box></>}
    </Box>

    {compact ? (
      <Box flexShrink={0}><Text color={sessionText ? C.orange : C.muted} wrap="truncate">{sessionText ?? activeText ?? (lastHistory ? `${lastHistory.time}  ${lastHistory.message}` : emptyHistory)}</Text></Box>
    ) : (
      <Box flexDirection="column" borderStyle={BORDER} borderColor={C.border} borderBackgroundColor={C.bg} paddingX={1} marginTop={1} flexShrink={0}>
        <Text bold color={C.orange}>RECENT ACTIVITY</Text>
        <Rule />
        {p.history.length
          ? p.history.slice(-4).map((entry, i) => <Text key={i} color={C.text} wrap="truncate"><Text color={C.muted}>{entry.time}  </Text>{entry.message}</Text>)
          : <Text color={C.muted}>{emptyHistory}</Text>}
        {sessionText ? <Text color={C.orange} wrap="truncate">{sessionText}</Text> : null}
        {activeText ? <Text color={C.muted} wrap="truncate">{activeText}</Text> : null}
      </Box>
    )}

    {prompt ? <Box flexShrink={0}><Text color={C.orange}>{prompt}</Text></Box> : null}
    <Box flexShrink={0} marginTop={compact ? 0 : 1} columnGap={2} flexWrap="wrap">
      <Text color={C.text}><Text bold color={C.orange}>[A]</Text> Approve</Text>
      <Text color={C.text}><Text bold color={C.orange}>[D]</Text> Deny</Text>
      <Text color={C.text}><Text bold color={C.orange}>[I]</Text> Inspect</Text>
      <Text color={C.text}><Text bold color={C.orange}>[R]</Text> Refresh</Text>
      {p.active ? <Text color={C.text}><Text bold color={C.orange}>[X]</Text> Revoke</Text> : null}
      <Text color={C.text}><Text bold color={C.orange}>[Q]</Text> Quit</Text>
    </Box>
    {compact ? null : <Box flexShrink={0}><Text color={C.muted} wrap="truncate">{`Arrow keys: select | Enter: details | Poll: ${p.intervalSeconds}s`}</Text></Box>}
  </Box>;
}
