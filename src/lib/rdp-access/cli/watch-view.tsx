import { Box, Text } from 'ink';
import type { RdpGrantSummary, RdpRequestExtras, RdpRequestSummary } from '../queries';
import type { HistoryLine, LiveConnections } from './watch-data';
import type { WatchMode } from './watch-state';

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
function fit(value: string, width: number): string {
  const clean = value.replace(/[\r\n\t]+/g, ' ');
  return clean.length <= width ? clean : clean.slice(0, Math.max(0, width - 3)) + '...';
}
function wait(created: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(created)) / 1000));
  if (!Number.isFinite(seconds)) return '-';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function Rule({ width }: { width: number }) { return <Text color={C.border}>{'-'.repeat(Math.max(0, width))}</Text>; }
function Field({ label, value }: { label: string; value: string }) {
  return <Box><Box width={14} flexShrink={0}><Text color={C.muted}>{label}</Text></Box><Box flexGrow={1}><Text color={C.text}>{value}</Text></Box></Box>;
}

/** Presentation only. Commands, approval policy and gateway behavior remain in the existing modules. */
export function WatchView(p: WatchViewProps) {
  const width = Math.max(20, p.columns - 1);
  const inner = width - 2;
  const wide = p.columns >= 95;
  const left = wide ? Math.floor((inner - 1) * 0.61) : inner;
  const right = wide ? inner - left - 1 : inner;
  const tableWidth = Math.max(1, left - 4);
  const detailWidth = Math.max(1, right - 4);
  const nameWidth = Math.max(4, tableWidth - 30);
  const middleHeight = wide ? Math.max(18, p.terminalRows - 23) : undefined;
  const visibleRows = wide ? Math.max(2, (middleHeight ?? 19) - 6) : 4;
  const start = Math.max(0, Math.min(p.selected - Math.floor(visibleRows / 2), p.requests.length - visibleRows));
  const nameOf = (id: string | null) => (id ? p.names.get(id) || short(id) : '-');
  const status = p.error ? 'OFFLINE' : p.busy ? 'WORKING' : p.loaded ? 'LIVE' : 'LOADING';
  const count = (n: number) => String(n).padStart(2, '0');
  const line = (id: string, user: string, route: string, age: string, selected: boolean) =>
    `${selected ? '>' : ' '} ${id.padEnd(8)} ${fit(user, nameWidth).padEnd(nameWidth)} ${route.padEnd(10)} ${age}`;

  return <Box width={width} minHeight={Math.max(1, p.terminalRows - 1)} flexDirection="column" backgroundColor={C.bg} padding={1}>
    <Box flexDirection="column" borderStyle={BORDER} borderColor={C.border} borderBackgroundColor={C.bg} paddingX={1} paddingY={1} flexShrink={0}>
      <Box justifyContent="space-between" flexWrap="wrap">
        <Text bold><Text color={C.orange}>KALFA</Text><Text color={C.text}> / RDP ACCESS</Text></Text>
        <Text color={C.muted}>{fit(p.hostname, 22)}  <Text bold color={C.orange}>{status}</Text></Text>
      </Box>
      <Rule width={Math.max(0, inner - 4)} />
      <Box gap={3} flexWrap="wrap">
        <Text bold color={C.muted}>PENDING <Text color={C.orange}>{p.loaded ? count(p.requests.length) : '--'}</Text></Text>
        <Text bold color={C.muted}>GRANT <Text color={C.text}>{p.loaded ? count(p.active ? 1 : 0) : '--'}</Text></Text>
        <Text bold color={C.muted}>LIVE <Text color={C.text}>{p.loaded && p.live.known ? count(p.live.count) : '--'}</Text></Text>
        <Text bold color={C.muted}>EXPIRED 24H <Text color={C.text}>{p.loaded ? count(p.expired24h) : '--'}</Text></Text>
      </Box>
    </Box>
    {p.error ? <Text color={C.orange}>Refresh failed ({p.error}). Decisions paused. [R] Retry.</Text> : null}
    <Box flexDirection={wide ? 'row' : 'column'} gap={1} marginTop={1} flexShrink={0}>
      <Box width={left} minHeight={middleHeight ?? 8} flexDirection="column" borderStyle={BORDER} borderColor={C.border} borderBackgroundColor={C.bg} paddingX={1} paddingY={1}>
        <Text bold color={C.orange}>ACCESS REQUESTS</Text>
        <Text bold color={C.muted}>{line('ID', 'USER', 'ROUTE', 'WAIT', false)}</Text>
        <Rule width={tableWidth} />
        {p.requests.length ? p.requests.slice(start, start + visibleRows).map((r, i) => {
          const selected = start + i === p.selected;
          return <Box key={r.id} backgroundColor={selected ? C.selected : C.bg} width={tableWidth}>
            <Text color={selected ? C.orange : C.text}>{line(short(r.id), nameOf(r.requester_id), p.route ?? '-', wait(r.created_at, p.now), selected)}</Text>
          </Box>;
        }) : <Text color={C.muted}>{p.loaded ? 'No pending requests.' : 'Loading requests...'}</Text>}
        {p.requests.length > visibleRows ? <Text color={C.muted}>{start + 1}-{Math.min(start + visibleRows, p.requests.length)} / {p.requests.length}</Text> : null}
      </Box>
      <Box width={right} minHeight={middleHeight ?? 10} flexDirection="column" borderStyle={BORDER} borderColor={C.border} borderBackgroundColor={C.bg} paddingX={1} paddingY={1}>
        <Text bold color={C.orange}>REQUEST DETAILS</Text>
        <Box height={1} />
        {p.chosen ? <>
          <Field label="Request" value={short(p.chosen.id)} />
          <Field label="Requester" value={nameOf(p.chosen.requester_id)} />
          <Field label="Gateway user" value={p.identity ?? 'Gateway not configured'} />
          <Field label="Request IP" value={p.extras.get(p.chosen.id)?.requestIp ?? 'Not recorded'} />
          <Field label="Route" value={p.route ?? 'Gateway not configured'} />
          <Field label="Target" value={p.target || '-'} />
          <Field label="Requested" value={time(p.chosen.created_at)} />
          <Field label="Duration" value={`${p.chosen.requested_minutes} minutes`} />
          <Box height={1} />
          <Rule width={detailWidth} />
          <Text color={C.muted}>{fit(p.chosen.reason, p.inspecting ? 500 : Math.max(40, detailWidth * 2))}</Text>
        </> : <>
          <Text color={C.muted}>Select a request to review.</Text>
          <Box height={1} />
          <Rule width={detailWidth} />
          <Text color={C.muted}>Approval grants temporary access.</Text>
          <Text color={C.muted}>Linux sign-in is still required.</Text>
        </>}
      </Box>
    </Box>
    <Box flexDirection="column" borderStyle={BORDER} borderColor={C.border} borderBackgroundColor={C.bg} paddingX={1} paddingY={1} marginTop={1} flexShrink={0}>
      <Text bold color={C.orange}>RECENT ACTIVITY</Text>
      <Rule width={Math.max(0, inner - 4)} />
      {p.history.length ? p.history.slice(-4).map((entry, i) => <Text key={`h${i}`} color={C.text}><Text color={C.muted}>{entry.time}  </Text>{fit(entry.message, Math.max(10, inner - 14))}</Text>) : <Text color={C.muted}>{p.loaded ? 'No access events yet.' : 'Loading activity...'}</Text>}
      {p.activity.length ? p.activity.slice(-1).map((entry, i) => <Text key={`a${i}`} color={C.orange}><Text color={C.muted}>{entry.time}  CLI  </Text>{fit(entry.message, Math.max(10, inner - 19))}</Text>) : null}
      {p.active ? <Text color={C.muted}>Active: {nameOf(p.active.user_id)} until {time(p.active.expires_at)} | Files {p.active.files_issued}/{p.active.max_files}{p.live.known ? ` | Live ${p.live.count}${p.live.tunnels[0] ? ` from ${p.live.tunnels[0].clientIp} since ${time(p.live.tunnels[0].connectedOn)}` : ''}` : ' | Live unknown'}</Text> : null}
    </Box>
    {p.mode.kind === 'approve' ? <Text color={C.orange}>Approve {short(p.mode.requestId)} for {p.mode.minutes} min? Left/Right duration | Enter confirm | Esc cancel</Text> : null}
    {p.mode.kind === 'deny' ? <Text color={C.orange}>Deny {short(p.mode.requestId)}? [Y] Confirm | Esc cancel</Text> : null}
    {p.mode.kind === 'revoke' ? <Text color={C.orange}>Revoke {short(p.mode.grantId)} and disconnect? [Y] Confirm | Esc cancel</Text> : null}
    <Box marginTop={1} gap={1} flexWrap="wrap" flexShrink={0}>
      <Text color={C.text}><Text bold color={C.orange}>[A]</Text> Approve  <Text bold color={C.orange}>[D]</Text> Deny  <Text bold color={C.orange}>[I]</Text> Inspect  <Text bold color={C.orange}>[R]</Text> Refresh  <Text bold color={C.orange}>[Q]</Text> Quit</Text>
      {p.active ? <Text color={C.text}><Text bold color={C.orange}>[X]</Text> Revoke</Text> : null}
    </Box>
    <Text color={C.muted}>Arrow keys: select | Enter: details | Poll: {p.intervalSeconds}s</Text>
  </Box>;
}
