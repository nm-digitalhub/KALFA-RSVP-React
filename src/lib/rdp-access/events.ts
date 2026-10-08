// Audit event kinds written to public.rdp_access_events. `kind` is an open text column on purpose (no
// Postgres enum), so this list is the application-side source of truth and rdp-access-migration.test.ts
// fails if the SQL writes a kind that is not listed here, or a listed kind is never written.

export const RDP_EVENT_KINDS = [
  'requested',
  'cancelled',
  'approved',
  'denied',
  'request_expired',
  'grant_expired',
  'file_issued',
  'file_refused',
  'file_failed',
  'grant_ended',
  'grant_revoked',
  'tunnel_check',
  'tunnel_closed',
  'access_removed',
  'disconnect_ok',
  'disconnect_failed',
] as const;

export type RdpEventKind = (typeof RDP_EVENT_KINDS)[number];

// For most kinds the outcome column only repeats the event ("approved" on `approved`, "ok" on `disconnect_ok`). It is
// worth showing only where it explains a failure or a refusal. One list, so the website's timeline and the owner CLI
// cannot disagree about it.
const OUTCOME_EXPLAINS: ReadonlySet<string> = new Set(['file_refused', 'file_failed', 'disconnect_failed', 'tunnel_closed']);

/** True when the outcome adds information for this kind. A kind this list does not know always shows its outcome. */
export function outcomeExplains(kind: string): boolean {
  return OUTCOME_EXPLAINS.has(kind) || !(RDP_EVENT_KINDS as readonly string[]).includes(kind);
}
