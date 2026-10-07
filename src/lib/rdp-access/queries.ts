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
  | 'last_cut_error'
>;
export type RdpEventSummary = Pick<Tables<'rdp_access_events'>, 'at' | 'kind' | 'actor_kind' | 'outcome'>;

const REQUEST_COLUMNS =
  'id, status, reason, requested_minutes, granted_minutes, requester_id, created_at, expires_at, answered_at' as const;
const GRANT_COLUMNS =
  'id, request_id, user_id, status, target, starts_at, expires_at, ended_at, ended_reason, files_issued, max_files, tunnels_cut_at, cut_attempts, last_cut_error' as const;

export class RdpQueryError extends Error {
  constructor(readonly operation: string) {
    super(`rdp-access: ${operation} failed`);
    this.name = 'RdpQueryError';
  }
}

// A uuid no row can have: an `active` filter with no live grant must match nothing, not everything.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

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

export type RdpOwnerListFilter = 'all' | 'pending' | 'active' | 'finished';
export type RdpOwnerListGrant = Pick<
  RdpGrantSummary,
  'id' | 'status' | 'files_issued' | 'max_files' | 'expires_at' | 'ended_at' | 'ended_reason'
>;
export type RdpOwnerListRow = RdpRequestSummary & { grant: RdpOwnerListGrant | null };

const LIST_GRANT_COLUMNS = 'id, request_id, status, files_issued, max_files, expires_at, ended_at, ended_reason' as const;

/**
 * One page of requests for the owner's read-only list, filtered and counted in the database.
 * `active` is the request behind the live grant (at most one); `finished` is everything that has been answered
 * and is not that one, so an approved request whose grant has ended is "finished" and a live one is not.
 */
export async function listRdpRequestsPage(
  admin: AdminClient,
  opts: { filter: RdpOwnerListFilter; page: number; pageSize: number; now: Date },
): Promise<{ rows: RdpOwnerListRow[]; total: number }> {
  const activeGrant =
    opts.filter === 'active' || opts.filter === 'finished' ? await getActiveRdpGrant(admin, opts.now) : null;

  let query = admin
    .from('rdp_access_requests')
    .select(REQUEST_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false });
  if (opts.filter === 'pending') query = query.eq('status', 'pending');
  if (opts.filter === 'active') query = query.eq('id', activeGrant?.request_id ?? NIL_UUID);
  if (opts.filter === 'finished') {
    query = query.neq('status', 'pending');
    if (activeGrant) query = query.neq('id', activeGrant.request_id);
  }
  const from = (opts.page - 1) * opts.pageSize;
  const requests = await query.range(from, from + opts.pageSize - 1);
  if (requests.error) throw new RdpQueryError('list_requests_page');

  const ids = requests.data.map((r) => r.id);
  const grantsByRequest = new Map<string, RdpOwnerListGrant>();
  if (ids.length > 0) {
    const grants = await admin.from('rdp_access_grants').select(LIST_GRANT_COLUMNS).in('request_id', ids);
    if (grants.error) throw new RdpQueryError('list_requests_page');
    for (const { request_id, ...grant } of grants.data) grantsByRequest.set(request_id, grant);
  }
  return {
    rows: requests.data.map((r) => ({ ...r, grant: grantsByRequest.get(r.id) ?? null })),
    total: requests.count ?? 0,
  };
}

/** The request id behind a grant (the audit row of a failed download needs both). */
export async function getRdpGrantRequestId(admin: AdminClient, grantId: string): Promise<string | null> {
  const { data, error } = await admin.from('rdp_access_grants').select('request_id').eq('id', grantId).limit(1);
  if (error) throw new RdpQueryError('get_grant_request_id');
  return data[0]?.request_id ?? null;
}

/**
 * Every time the gateway allowed a new tunnel, per grant, oldest first. The gateway asks once per new tunnel, so a
 * grant has only a handful of such rows.
 */
export async function listGatewayAllows(admin: AdminClient, grantIds: readonly string[]): Promise<Map<string, string[]>> {
  const allows = new Map<string, string[]>();
  if (grantIds.length === 0) return allows;
  const { data, error } = await admin
    .from('rdp_access_events')
    .select('grant_id, at')
    .eq('kind', 'tunnel_check')
    .eq('outcome', 'allow')
    .in('grant_id', [...grantIds])
    .order('at', { ascending: true });
  if (error) throw new RdpQueryError('list_gateway_allows');
  for (const row of data) {
    if (!row.grant_id) continue;
    const times = allows.get(row.grant_id);
    if (times) times.push(row.at);
    else allows.set(row.grant_id, [row.at]);
  }
  return allows;
}

/** When the gateway first allowed a tunnel, per grant: the one measured trace that a connection happened. */
export async function listFirstGatewayAllows(admin: AdminClient, grantIds: readonly string[]): Promise<Map<string, string>> {
  const first = new Map<string, string>();
  for (const [grantId, times] of await listGatewayAllows(admin, grantIds)) first.set(grantId, times[0]!);
  return first;
}

export type RdpTunnelTrace = { tunnelId: string; grantId: string; requestId: string | null; at: string };

/**
 * The gateway's allowed checks per tunnel: which grant and request each tunnel was opened under. The check's
 * `tunnel_ref` IS the gateway's tunnel id (the same `Id` the admin API lists), verified in the pinned gateway source
 * and in the recorded events. EVERY allowed check of a tunnel is returned, oldest first, so a caller can see a tunnel
 * that is recorded under more than one grant instead of silently keeping the first. A tunnel with no entry has no
 * permission on record.
 */
export async function listTunnelTraces(admin: AdminClient, tunnelIds: readonly string[]): Promise<Map<string, RdpTunnelTrace[]>> {
  const traces = new Map<string, RdpTunnelTrace[]>();
  if (tunnelIds.length === 0) return traces;
  const { data, error } = await admin
    .from('rdp_access_events')
    .select('tunnel_ref, grant_id, request_id, at')
    .eq('kind', 'tunnel_check')
    .eq('outcome', 'allow')
    .in('tunnel_ref', [...tunnelIds])
    .order('at', { ascending: true });
  if (error) throw new RdpQueryError('list_tunnel_traces');
  for (const row of data) {
    if (!row.tunnel_ref || !row.grant_id) continue;
    const trace: RdpTunnelTrace = { tunnelId: row.tunnel_ref, grantId: row.grant_id, requestId: row.request_id, at: row.at };
    const existing = traces.get(row.tunnel_ref);
    if (existing) existing.push(trace);
    else traces.set(row.tunnel_ref, [trace]);
  }
  return traces;
}

export async function listGrantsByIds(admin: AdminClient, grantIds: readonly string[]): Promise<Map<string, RdpGrantSummary>> {
  const grants = new Map<string, RdpGrantSummary>();
  if (grantIds.length === 0) return grants;
  const { data, error } = await admin.from('rdp_access_grants').select(GRANT_COLUMNS).in('id', [...grantIds]);
  if (error) throw new RdpQueryError('list_grants_by_ids');
  for (const row of data) grants.set(row.id, row);
  return grants;
}

export async function listRequestsByIds(admin: AdminClient, requestIds: readonly string[]): Promise<Map<string, RdpRequestSummary>> {
  const requests = new Map<string, RdpRequestSummary>();
  if (requestIds.length === 0) return requests;
  const { data, error } = await admin.from('rdp_access_requests').select(REQUEST_COLUMNS).in('id', [...requestIds]);
  if (error) throw new RdpQueryError('list_requests_by_ids');
  for (const row of data) requests.set(row.id, row);
  return requests;
}

export type RdpRequestExtras = { requestIp: string | null; answerNote: string | null; answeredBy: string | null };

/**
 * The request fields the summary rows leave out: the address the request came from, the owner's own answer note and
 * who answered. `request_ip` is an inet column the generated types call `unknown`; it reaches here as text. One query for
 * any number of requests (the CLI asks for every pending row at once, the owner's detail page for one).
 */
export async function listRdpRequestExtras(
  admin: AdminClient,
  requestIds: readonly string[],
): Promise<Map<string, RdpRequestExtras>> {
  const extras = new Map<string, RdpRequestExtras>();
  if (requestIds.length === 0) return extras;
  const { data, error } = await admin
    .from('rdp_access_requests')
    .select('id, request_ip, answer_note, answered_by')
    .in('id', [...requestIds]);
  if (error) throw new RdpQueryError('list_request_extras');
  for (const row of data) {
    extras.set(row.id, {
      requestIp: typeof row.request_ip === 'string' ? row.request_ip : null,
      answerNote: row.answer_note ?? null,
      answeredBy: row.answered_by ?? null,
    });
  }
  return extras;
}

export async function getRdpRequestOwnerExtras(admin: AdminClient, requestId: string): Promise<RdpRequestExtras> {
  const extras = await listRdpRequestExtras(admin, [requestId]);
  return extras.get(requestId) ?? { requestIp: null, answerNote: null, answeredBy: null };
}

export type RdpRecentEvent = {
  at: string;
  kind: string;
  actorKind: string;
  requestId: string | null;
  outcome: string | null;
};

/** The newest audit events across every request, newest first. Kind, actor and a short outcome code only. */
export async function listRecentRdpEvents(admin: AdminClient, opts: { limit: number }): Promise<RdpRecentEvent[]> {
  const { data, error } = await admin
    .from('rdp_access_events')
    .select('at, kind, actor_kind, request_id, outcome')
    .order('at', { ascending: false })
    .limit(opts.limit);
  if (error) throw new RdpQueryError('list_recent_events');
  return data.map((e) => ({ at: e.at, kind: e.kind, actorKind: e.actor_kind, requestId: e.request_id, outcome: e.outcome }));
}

/** How many requests were created since `since` and ended with this status (a measured count, not a guess from a page). */
export async function countRdpRequestsSince(
  admin: AdminClient,
  opts: { status: 'expired' | 'denied' | 'cancelled' | 'approved'; since: Date },
): Promise<number> {
  const { count, error } = await admin
    .from('rdp_access_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', opts.status)
    .gte('created_at', opts.since.toISOString());
  if (error) throw new RdpQueryError('count_requests_since');
  return count ?? 0;
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
/** Every owner's user id (deduplicated). The approver lookup and the owner notifications both start from this one query. */
export async function listRdpOwnerIds(admin: AdminClient): Promise<string[]> {
  const roles = await admin.from('platform_roles').select('id').eq('is_owner_role', true);
  if (roles.error) throw new RdpQueryError('list_owners');
  const roleIds = roles.data.map((r) => r.id);
  if (roleIds.length === 0) return [];

  const staff = await admin.from('platform_staff').select('user_id').in('role_id', roleIds);
  if (staff.error) throw new RdpQueryError('list_owners');
  return [...new Set(staff.data.map((s) => s.user_id))];
}

export async function resolveOwner(admin: AdminClient, hint?: string): Promise<OwnerResolution> {
  const ownerIds = await listRdpOwnerIds(admin);

  if (hint) {
    return ownerIds.includes(hint) ? { ok: true, ownerId: hint } : { ok: false, reason: 'not_owner', ownerIds };
  }
  if (ownerIds.length === 0) return { ok: false, reason: 'no_owner', ownerIds };
  if (ownerIds.length > 1) return { ok: false, reason: 'ambiguous', ownerIds };
  return { ok: true, ownerId: ownerIds[0]! };
}
