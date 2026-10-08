import type { RdpEventKind } from '../events';
import { outcomeExplains, RDP_EVENT_KINDS } from '../events';
import type { RdpRecentEvent } from '../queries';
import { shortId } from './format';

// Everything the watch screen shows that is not a keypress, derived as plain functions so the screen stays a thin
// renderer and each field can be tested without a terminal. Nothing here guesses: a value that is not known is
// reported as unknown (null), and the screen says so instead of filling it in.

// One line per audit event kind, in the language of the screen. Typed against the application's own event list, so a
// new kind that this screen was not taught is a compile error, not a blank line.
const EVENT_LINE: Record<RdpEventKind, string> = {
  requested: 'Request created',
  cancelled: 'Request cancelled by the requester',
  approved: 'Approved',
  denied: 'Denied',
  request_expired: 'Request expired unanswered',
  grant_expired: 'Access window ended',
  file_issued: 'Connection file downloaded',
  file_refused: 'File download refused',
  file_failed: 'File preparation failed',
  grant_ended: 'Access ended by the requester',
  grant_revoked: 'Access revoked',
  tunnel_check: 'Gateway check',
  tunnel_closed: 'Connection closed',
  access_removed: 'Permission removed from the requester',
  disconnect_ok: 'Live connections cut',
  disconnect_failed: 'Cutting live connections failed',
};

function isEventKind(kind: string): kind is RdpEventKind {
  return (RDP_EVENT_KINDS as readonly string[]).includes(kind);
}

/** `<id8>  Approved`, `--------  Gateway check: denied (no_active_grant)`. An unknown kind is shown by its own code. */
export function describeRecentEvent(event: Pick<RdpRecentEvent, 'kind' | 'requestId' | 'outcome'>): string {
  const id = event.requestId ? shortId(event.requestId) : '--------';
  const base = isEventKind(event.kind) ? EVENT_LINE[event.kind] : event.kind;
  if (event.kind === 'tunnel_check') {
    if (event.outcome === 'allow') return `${id}  ${base}: allowed`;
    const reason = event.outcome?.replace(/^deny:/, '');
    return `${id}  ${base}: denied${reason ? ` (${reason})` : ''}`;
  }
  return `${id}  ${base}${event.outcome && outcomeExplains(event.kind) ? ` (${event.outcome})` : ''}`;
}

export type HistoryLine = { time: string; message: string };

/** Newest-first events become oldest-first lines (the screen shows the tail), each with its already formatted time. */
export function toHistoryLines(events: readonly RdpRecentEvent[], formatTime: (iso: string) => string): HistoryLine[] {
  return [...events].reverse().map((event) => ({ time: formatTime(event.at), message: describeRecentEvent(event) }));
}
