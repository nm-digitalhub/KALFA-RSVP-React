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
 * `connected` is INFERRED, not measured: nothing in the grant row says a tunnel was opened (the gateway reports that
 * only through the audit trail), so it is shown as reached only because a connection file was downloaded.
 */
export function stationStatesFor(status: RdpDisplayStatus, filesIssued: number): StationStates {
  switch (status) {
    case 'pending':
      return ['done', 'waiting', 'upcoming', 'upcoming'];
    case 'active':
      return filesIssued > 0 ? ['done', 'done', 'done', 'current'] : ['done', 'done', 'current', 'upcoming'];
    case 'ended':
      return filesIssued > 0 ? ['done', 'done', 'done', 'done'] : ['done', 'done', 'stopped', 'upcoming'];
    case 'denied':
    case 'expired':
    case 'cancelled':
      return ['done', 'stopped', 'upcoming', 'upcoming'];
  }
}
