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
