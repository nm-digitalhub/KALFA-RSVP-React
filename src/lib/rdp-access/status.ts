// One display status for a request, derived from the request row and its grant. The two tables each have their own
// vocabulary (a request is `approved` forever, the grant is what is live or over), and every screen needs the
// combined answer. No I/O: the owner module and the screens both use it.

export const RDP_DISPLAY_STATUSES = ['pending', 'active', 'ended', 'denied', 'expired', 'cancelled'] as const;
export type RdpDisplayStatus = (typeof RDP_DISPLAY_STATUSES)[number];

export function deriveRdpDisplayStatus(
  requestStatus: string,
  grant: { status: string; expires_at: string } | null,
  now: Date,
): RdpDisplayStatus {
  switch (requestStatus) {
    case 'pending':
      return 'pending';
    case 'approved':
      // a grant past its end is over even if the sweep has not marked it yet (the database already refuses it)
      return grant && grant.status === 'active' && Date.parse(grant.expires_at) > now.getTime() ? 'active' : 'ended';
    case 'denied':
      return 'denied';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'expired';
  }
}

// The four-station track (request, owner approval, connection file, connected) as data: where a request is on it.
// The screens draw it; this is the one place that decides which station is in which state.
export type StationState = 'done' | 'current' | 'waiting' | 'upcoming' | 'stopped';
export type StationStates = readonly [StationState, StationState, StationState, StationState];

/**
 * `connected` is the one station the grant row cannot tell: the gateway reports it only through the audit trail. It is
 * lit ONLY when the gateway has recorded an allowed tunnel for the grant (see firstGatewayAllow), never because a file
 * was downloaded: a download does not mean the file was opened.
 */
export function stationStatesFor(status: RdpDisplayStatus, trace: { filesIssued: number; connected: boolean }): StationStates {
  switch (status) {
    case 'pending':
      return ['done', 'waiting', 'upcoming', 'upcoming'];
    case 'active':
      return trace.connected ? ['done', 'done', 'done', 'current'] : ['done', 'done', 'current', 'upcoming'];
    case 'ended':
      if (trace.connected) return ['done', 'done', 'done', 'done'];
      return trace.filesIssued > 0 ? ['done', 'done', 'done', 'stopped'] : ['done', 'done', 'stopped', 'upcoming'];
    case 'denied':
    case 'expired':
    case 'cancelled':
      return ['done', 'stopped', 'upcoming', 'upcoming'];
  }
}

/**
 * When the gateway first allowed a tunnel for a grant: the one measured trace of a connection (the gateway asks the
 * app once per new tunnel, and the app logs `tunnel_check` with outcome `allow`). Null when it never did. `events` may
 * be in any order.
 */
export function firstGatewayAllow(events: readonly { at: string; kind: string; outcome: string | null }[]): string | null {
  let first: string | null = null;
  for (const event of events) {
    if (event.kind !== 'tunnel_check' || event.outcome !== 'allow') continue;
    if (first === null || Date.parse(event.at) < Date.parse(first)) first = event.at;
  }
  return first;
}
