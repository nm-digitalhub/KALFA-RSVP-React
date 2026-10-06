import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/types';

// Read-side helpers for the owner CLI (and, later, the owner's read-only screens). Service role, so the column
// lists are EXPLICIT: the browser roles only hold column-level grants on these tables, and a select('*') written
// for one role would fail with 42501 for the other. Row shapes are derived from the generated tables.
//
// Errors carry the operation name only (see RdpAccessServiceError): no PostgREST message reaches a terminal or log.

type AdminClient = ReturnType<typeof createAdminClient>;

export type RdpRequestSummary = Pick<
  Tables<'rdp_access_requests'>,
  'id' | 'status' | 'reason' | 'requested_minutes' | 'granted_minutes' | 'requester_id' | 'created_at' | 'expires_at' | 'answered_at'
>;
export type RdpGrantSummary = Pick<
  Tables<'rdp_access_grants'>,
  | 'id'
  | 'request_id'
  | 'user_id'
  | 'status'
  | 'target'
  | 'starts_at'
  | 'expires_at'
  | 'ended_at'
  | 'ended_reason'
  | 'files_issued'
  | 'max_files'
  | 'tunnels_cut_at'
  | 'cut_attempts'
>;
export type RdpEventSummary = Pick<Tables<'rdp_access_events'>, 'at' | 'kind' | 'actor_kind' | 'outcome'>;

const REQUEST_COLUMNS =
  'id, status, reason, requested_minutes, granted_minutes, requester_id, created_at, expires_at, answered_at' as const;
const GRANT_COLUMNS =
  'id, request_id, user_id, status, target, starts_at, expires_at, ended_at, ended_reason, files_issued, max_files, tunnels_cut_at, cut_attempts' as const;

export class RdpQueryError extends Error {
  constructor(readonly operation: string) {
    super(`rdp-access: ${operation} failed`);
    this.name = 'RdpQueryError';
  }
}

export type RdpStatusFilter = 'pending' | 'active' | 'all';

export async function listRdpRequests(
  admin: AdminClient,
  opts: { status: RdpStatusFilter; limit?: number },
): Promise<RdpRequestSummary[]> {
  let query = admin.from('rdp_access_requests').select(REQUEST_COLUMNS).order('created_at', { ascending: false });
  if (opts.status === 'pending') query = query.eq('status', 'pending');
  if (opts.status === 'active') query = query.eq('status', 'approved');
  const { data, error } = await query.limit(opts.limit ?? 50);
  if (error) throw new RdpQueryError('list_requests');
  return data;
}

export async function getActiveRdpGrant(admin: AdminClient, now: Date): Promise<RdpGrantSummary | null> {
  const { data, error } = await admin
    .from('rdp_access_grants')
    .select(GRANT_COLUMNS)
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .limit(1);
  if (error) throw new RdpQueryError('get_active_grant');
  return data[0] ?? null;
}

export async function countPendingRdpRequests(admin: AdminClient): Promise<number> {
  const { count, error } = await admin
    .from('rdp_access_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw new RdpQueryError('count_pending');
  return count ?? 0;
}

export async function getRdpRequestDetail(admin: AdminClient, requestId: string) {
  const [request, grants, events] = await Promise.all([
    admin.from('rdp_access_requests').select(REQUEST_COLUMNS).eq('id', requestId).limit(1),
    admin.from('rdp_access_grants').select(GRANT_COLUMNS).eq('request_id', requestId).limit(1),
    admin
      .from('rdp_access_events')
      .select('at, kind, actor_kind, outcome')
      .eq('request_id', requestId)
      .order('at', { ascending: true })
      .limit(200),
  ]);
  if (request.error || grants.error || events.error) throw new RdpQueryError('get_request_detail');
  const row = request.data[0];
  if (!row) return null;
  return { request: row, grant: grants.data[0] ?? null, events: events.data satisfies RdpEventSummary[] };
}

/** Display names for a set of user ids (owner-facing terminal output only). */
export async function nameMap(admin: AdminClient, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  const { data, error } = await admin.from('profiles').select('id, full_name').in('id', wanted);
  if (error) throw new RdpQueryError('name_map');
  for (const row of data) if (row.full_name) names.set(row.id, row.full_name);
  return names;
}

/**
 * Resolve a full request id from what the owner typed: a full uuid, or a prefix of at least 4 hex characters
 * (the CLI prints the first 8). Ambiguity is an error, never a guess.
 */
export async function resolveRdpRequestId(
  admin: AdminClient,
  typed: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'invalid' | 'not_found' | 'ambiguous' }> {
  const value = typed.trim().toLowerCase();
  if (!/^[0-9a-f-]{4,36}$/.test(value)) return { ok: false, reason: 'invalid' };
  const { data, error } = await admin
    .from('rdp_access_requests')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new RdpQueryError('resolve_request_id');
  const matches = data.filter((r) => r.id.startsWith(value));
  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, id: matches[0]!.id };
}

export type OwnerResolution =
  | { ok: true; ownerId: string }
  | { ok: false; reason: 'no_owner' | 'ambiguous' | 'not_owner'; ownerIds: string[] };

/**
 * The approver identity for the CLI. The CLI runs on the server with the service role, so this is ATTRIBUTION,
 * not authentication: with exactly one owner that owner is used; with several the caller must name one with
 * --as <uuid>, and a name that is not an owner is refused. rdp_answer_request / rdp_end_grant verify the owner
 * status again inside the database.
 */
export async function resolveOwner(admin: AdminClient, hint?: string): Promise<OwnerResolution> {
  const roles = await admin.from('platform_roles').select('id').eq('is_owner_role', true);
  if (roles.error) throw new RdpQueryError('resolve_owner');
  const roleIds = roles.data.map((r) => r.id);
  if (roleIds.length === 0) return { ok: false, reason: 'no_owner', ownerIds: [] };

  const staff = await admin.from('platform_staff').select('user_id').in('role_id', roleIds);
  if (staff.error) throw new RdpQueryError('resolve_owner');
  const ownerIds = [...new Set(staff.data.map((s) => s.user_id))];

  if (hint) {
    return ownerIds.includes(hint) ? { ok: true, ownerId: hint } : { ok: false, reason: 'not_owner', ownerIds };
  }
  if (ownerIds.length === 0) return { ok: false, reason: 'no_owner', ownerIds };
  if (ownerIds.length > 1) return { ok: false, reason: 'ambiguous', ownerIds };
  return { ok: true, ownerId: ownerIds[0]! };
}
