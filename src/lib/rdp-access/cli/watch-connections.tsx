import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import { useRef } from 'react';
import { formatCountdown } from '../countdown';
import type { ConnectionDetail, PermissionState } from '../connections';
import { clock, shortId as short } from './format';
import type { ConnectionRow, ConnectionsState } from './connections-state';

// The "connections" view of the watch screen: what the gateway holds open, and the permission behind each connection.
// Read-only and layout-agnostic: watch-view.tsx puts these pieces in its panels and decides the breakpoints.

const C = { selected: '#382019', orange: '#FF5A3C', text: '#E6E8EB', muted: '#9AA4AF' };

const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));
const duration = (ms: number) => formatCountdown(seconds(ms) * 1000, { hours: true });

// ── pure: what each row and each details line says ───────────────────────────

const PERMISSION_TAG: Record<PermissionState, string> = {
  active: 'ACTIVE', expired: 'EXPIRED', revoked: 'REVOKED', ended: 'ENDED', unknown: 'UNKNOWN',
};
const PERMISSION_TEXT: Record<PermissionState, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked by the owner',
  ended: 'Ended by the user',
  unknown: 'Unknown status',
};

/** The short tag of a row: the permission it is attributed to, or why there is none. A gone row says so first. */
export function rowTag(row: ConnectionRow): string {
  if (row.link === 'gone') return 'GONE';
  const c = row.connection;
  switch (c.attribution) {
    case 'attributed':
      return c.permission ? PERMISSION_TAG[c.permission] : 'UNKNOWN';
    case 'none':
      return 'NO MATCH';
    case 'ambiguous':
      return 'UNCLEAR';
    case 'unavailable':
      return 'NO DATA';
  }
}

/**
 * True for a connection the gateway holds open under a permission that is certainly over. Only an attribution that
 * is certain counts: no match, an unclear record or a failed lookup never make a connection "unauthorized".
 */
export function isOverdue(row: ConnectionRow): boolean {
  const c = row.connection;
  return row.link !== 'gone' && c.attribution === 'attributed' && c.permission !== null && c.permission !== 'active';
}

/** How long the permission still has to run, only while it is active. */
export function timeLeftMs(c: ConnectionDetail, now: Date): number | null {
  if (c.attribution !== 'attributed' || c.permission !== 'active' || !c.grantExpiresAt) return null;
  return Math.max(0, Date.parse(c.grantExpiresAt) - now.getTime());
}

const ATTRIBUTION_NOTE: Record<'none' | 'ambiguous' | 'unavailable', string> = {
  none: 'No attribution found. The gateway lists this connection, but no allowed check is recorded for it (yet). The next refresh looks again. This does not by itself mean it is unauthorized.',
  ambiguous: 'The records do not allow a decision: the tunnel is recorded under more than one permission, or under one that cannot be found.',
  unavailable: 'The attribution check failed: the database could not be read. This does NOT mean the connection has no permission.',
};

function connectionStatus(row: ConnectionRow, state: ConnectionsState): string {
  if (row.link === 'gone') return `No longer listed since ${clock(row.goneAt ?? '')} (missing from a successful gateway answer)`;
  if (row.link === 'unknown') return `Unknown: the gateway did not answer${state.fetchedAt ? ` (last answer ${clock(state.fetchedAt)})` : ''}`;
  return `Open (listed by the gateway at ${state.fetchedAt ? clock(state.fetchedAt) : '-'})`;
}

export type DetailLine = { label: string; value: string; emphasis?: boolean };

/** Every line of the details of one connection, in order of importance. The view clips or scrolls them. */
export function connectionDetailLines(row: ConnectionRow, state: ConnectionsState, names: ReadonlyMap<string, string>, now: Date): DetailLine[] {
  const c = row.connection;
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? short(id)) : '-');
  const end = row.link === 'gone' && row.goneAt ? Date.parse(row.goneAt) : now.getTime();
  const left = timeLeftMs(c, now);
  const lines: DetailLine[] = [
    { label: 'Connection', value: connectionStatus(row, state) },
    { label: 'Tunnel', value: c.tunnelId },
    { label: 'Connection IP', value: c.clientIp },
    { label: 'Target', value: c.target },
    { label: 'Opened', value: clock(c.connectedOn) },
    { label: row.link === 'gone' ? 'Was open for' : 'Open for', value: duration(end - Date.parse(c.connectedOn)) },
    {
      label: 'Gateway data',
      value: state.gateway === 'ok' && state.fetchedAt
        ? `${clock(state.fetchedAt)} (${seconds(now.getTime() - Date.parse(state.fetchedAt))}s ago)`
        : `Failed${state.failedAt ? ` at ${clock(state.failedAt)}` : ''}; showing the last answer${state.fetchedAt ? ` of ${clock(state.fetchedAt)}` : ' (none yet)'}`,
    },
  ];

  if (c.attribution !== 'attributed') {
    lines.push({ label: 'Permission', value: ATTRIBUTION_NOTE[c.attribution] });
    return lines;
  }

  lines.push({ label: 'Permission', value: c.permission ? PERMISSION_TEXT[c.permission] : 'Unknown status', emphasis: isOverdue(row) });
  if (left !== null) lines.push({ label: 'Time left', value: duration(left) });
  if (c.grantStartsAt && c.grantExpiresAt) lines.push({ label: 'Window', value: `${clock(c.grantStartsAt)} - ${clock(c.grantExpiresAt)}` });
  if (c.grantEndedAt) lines.push({ label: 'Ended at', value: clock(c.grantEndedAt) });
  lines.push({ label: 'Requester', value: nameOf(c.requesterId) });
  lines.push({ label: 'Reason', value: c.reason ?? '-' });
  lines.push({ label: 'Request IP', value: c.requestIp ?? 'Not recorded' });
  lines.push({ label: 'Request', value: c.requestId ?? '-' });
  lines.push({ label: 'Grant', value: c.grantId ?? '-' });
  lines.push({ label: 'Approved by', value: nameOf(c.approverId) });
  lines.push({
    label: 'Approved for',
    value: c.grantedMinutes === null ? '-' : `${c.grantedMinutes} minutes${c.requestedMinutes !== null && c.requestedMinutes !== c.grantedMinutes ? ` (asked ${c.requestedMinutes})` : ''}`,
  });
  lines.push({ label: 'Tunnels opened', value: `${c.tunnelsOpened} under this grant` });
  if (c.filesIssued !== null && c.maxFiles !== null) lines.push({ label: 'Files', value: `${c.filesIssued}/${c.maxFiles} downloaded` });
  // shown only when the grant row says a disconnect was really looked at, never inferred
  if (c.cut && c.cut !== 'not_needed') {
    const text = {
      not_attempted: 'Not attempted yet',
      pending: 'Done once, waiting for the second check',
      failed: `Failed${c.cutError ? ` (${c.cutError})` : ''}`,
      confirmed: 'Confirmed',
    }[c.cut];
    lines.push({ label: 'Disconnect', value: text });
  }
  return lines;
}

// ── drawing ──────────────────────────────────────────────────────────────────

/** The list banner: the one line that says how far the list can be trusted. */
export function listBanner(state: ConnectionsState, now: Date): string | null {
  // short on purpose: a line is cut at the edge of its panel, and the first words are the ones that must survive.
  // The full facts (when it failed, how old the list is) are in the details, under "Gateway data".
  if (state.gateway === 'unconfigured') return 'Gateway not configured.';
  if (state.gateway === 'failed') {
    return state.fetchedAt
      ? `STALE (not current): last answer ${clock(state.fetchedAt)}, ${seconds(now.getTime() - Date.parse(state.fetchedAt))}s ago`
      : `Gateway silent${state.failedAt ? ` at ${clock(state.failedAt)}` : ''}. Nothing known yet.`;
  }
  if (state.gateway === 'ok' && state.attribution === 'failed') return 'Database unavailable: permissions not shown.';
  return null;
}

type ListProps = {
  rows: ConnectionRow[];
  selectedId: string | null;
  state: ConnectionsState;
  now: Date;
  names: ReadonlyMap<string, string>;
  columns: number;
};

const SHOW_TARGET_COLUMNS = 140;
const SHOW_AGE_COLUMNS = 70;

/** The rows, in a box that clips and scrolls to keep the selected one in view (the height is measured). */
export function ConnectionRows(p: ListProps) {
  const ref = useRef<DOMElement>(null);
  const { height, hasMeasured } = useBoxMetrics(ref);
  const index = Math.max(0, p.rows.findIndex((r) => r.connection.tunnelId === p.selectedId));
  const offset = hasMeasured ? Math.max(0, index + 1 - height) : 0;
  const nameOf = (id: string | null) => (id ? (p.names.get(id) ?? short(id)) : null);

  return <Box ref={ref} flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
    <Box flexDirection="column" flexShrink={0} contentOffsetY={offset}>
      {p.rows.length ? p.rows.map((row) => {
        const c = row.connection;
        const selected = c.tunnelId === p.selectedId;
        const overdue = isOverdue(row);
        const dim = row.link !== 'open';
        const color = selected || overdue ? C.orange : dim ? C.muted : C.text;
        const left = timeLeftMs(c, p.now);
        const marker = overdue ? '!' : row.link === 'unknown' ? '?' : row.link === 'gone' ? '-' : selected ? '>' : ' ';
        return <Box key={c.tunnelId} height={1} flexShrink={0} backgroundColor={selected ? C.selected : undefined}>
          <Box width={2} flexShrink={0}><Text bold={overdue} color={color}>{selected && marker === ' ' ? '>' : marker}</Text></Box>
          <Box width={9} flexShrink={0}><Text bold={overdue} color={color}>{short(c.tunnelId)}</Text></Box>
          <Box flexGrow={1} flexShrink={1}><Text bold={overdue} color={color} wrap="truncate">{nameOf(c.requesterId) ?? (c.attribution === 'attributed' ? 'Unknown requester' : '-')}</Text></Box>
          {p.columns >= SHOW_TARGET_COLUMNS ? <Box width={28} flexShrink={0}><Text color={color} wrap="truncate">{c.target}</Text></Box> : null}
          {p.columns >= SHOW_AGE_COLUMNS ? <Box width={10} flexShrink={0}><Text color={color}>{duration((row.link === 'gone' && row.goneAt ? Date.parse(row.goneAt) : p.now.getTime()) - Date.parse(c.connectedOn))}</Text></Box> : null}
          <Box width={10} flexShrink={0}><Text color={color}>{left === null ? '-' : duration(left)}</Text></Box>
          <Box width={9} flexShrink={0}><Text bold={overdue} color={color}>{rowTag(row)}</Text></Box>
        </Box>;
      }) : <Text color={C.muted}>{emptyText(p.state)}</Text>}
    </Box>
  </Box>;
}

/** What an empty list means. Only a successful, empty answer from the gateway may say "none". */
export function emptyText(state: ConnectionsState): string {
  if (state.gateway === 'ok') return 'No open connections in the gateway.';
  if (state.gateway === 'unknown') return 'Loading connections...';
  return 'Connections unknown: the gateway could not be asked.';
}

export function ConnectionsHeader({ columns }: { columns: number }) {
  return <Box height={1} flexShrink={0}>
    <Box width={11} flexShrink={0}><Text bold color={C.muted}>TUNNEL</Text></Box>
    <Box flexGrow={1}><Text bold color={C.muted}>REQUESTER</Text></Box>
    {columns >= SHOW_TARGET_COLUMNS ? <Box width={28} flexShrink={0}><Text bold color={C.muted}>TARGET</Text></Box> : null}
    {columns >= SHOW_AGE_COLUMNS ? <Box width={10} flexShrink={0}><Text bold color={C.muted}>OPEN</Text></Box> : null}
    <Box width={10} flexShrink={0}><Text bold color={C.muted}>LEFT</Text></Box>
    <Box width={9} flexShrink={0}><Text bold color={C.muted}>PERMIT</Text></Box>
  </Box>;
}

/** The detail lines as rows; the full-width view scrolls them with `scroll`, the side panel clips them. */
export function ConnectionDetailRows({ lines, scroll = 0 }: { lines: DetailLine[]; scroll?: number }) {
  return <Box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
    <Box flexDirection="column" flexShrink={0} contentOffsetY={scroll}>
      {lines.map((line) => <Box key={line.label} flexShrink={0}>
        <Box width={15} flexShrink={0}><Text color={C.muted}>{line.label}</Text></Box>
        <Box flexGrow={1} flexShrink={1}><Text bold={line.emphasis} color={line.emphasis ? C.orange : C.text}>{line.value}</Text></Box>
      </Box>)}
    </Box>
  </Box>;
}

