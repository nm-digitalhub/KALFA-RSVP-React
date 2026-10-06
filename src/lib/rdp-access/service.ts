import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/types';

import { RDP_CUT_MAX_ATTEMPTS, RDP_CUT_RETRY_AFTER_SECONDS, RDP_CUT_WINDOW_HOURS } from './policy';

// Thin, typed wrappers over the rdp_* functions of 20261006164315_rdp_access_approval.sql.
//
// Every one of those functions is executable by service_role ONLY, so this module takes the admin
// client as a parameter (the same shape as runFleetExpireSweep) and callers pass createAdminClient().
// The user id always comes from the server session (getUser) or, for the CLI, from the verified owner
// lookup. It never comes from the browser.
//
// Types are DERIVED from the generated Database, nothing is declared by hand per function. The one
// gap the generator cannot express is that RETURNS TABLE columns are typed non-null while the refusal
// paths return NULL (`return query select 'not_allowed', null::uuid, ...`). NullableExcept widens every
// column except the discriminator, so a caller is forced to handle the null instead of trusting it.
//
// Fail closed: a database error, an empty result or an outcome string this module does not know about
// never becomes a success. Errors carry the operation name only (no PostgREST message, which can name
// columns, constraints or values).

type AdminClient = ReturnType<typeof createAdminClient>;
type Functions = Database['public']['Functions'];
type RowOf<K extends keyof Functions> = Functions[K] extends { Returns: (infer R)[] } ? R : never;
type NullableExcept<T, Keep extends keyof T> = Pick<T, Keep> & { [P in Exclude<keyof T, Keep>]: T[P] | null };

export class RdpAccessServiceError extends Error {
  constructor(readonly operation: string) {
    super(`rdp-access: ${operation} failed`);
    this.name = 'RdpAccessServiceError';
  }
}

// A deadlock (40P01) or serialization failure (40001) rolls the WHOLE transaction back, so repeating the same
// call once is always safe. The expiry step of each rdp_* function never waits, but two different functions can
// still wait on rows the other's expiry step locked (rare).
const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['40P01', '40001']);

async function retryOnDeadlock<T extends { error: { code: string } | null }>(call: () => PromiseLike<T>): Promise<T> {
  const first = await call();
  if (first.error && RETRYABLE_SQLSTATES.has(first.error.code)) return call();
  return first;
}

function firstRow<T>(operation: string, result: { data: readonly T[] | null; error: unknown }): T {
  const row = result.data?.[0];
  if (result.error || row === undefined) throw new RdpAccessServiceError(operation);
  return row;
}

function isOneOf<const T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value);
}

// An outcome the module does not recognise is reported as 'unexpected' (never as a success), so a
// future SQL outcome that this code was not updated for degrades into a visible refusal.
function outcomeOf<const T extends readonly string[]>(value: string, allowed: T): T[number] | 'unexpected' {
  return isOneOf(value, allowed) ? value : 'unexpected';
}

export const REQUEST_ACCESS_OUTCOMES = [
  'created',
  'already_pending',
  'has_active_grant',
  'rate_limited',
  'not_allowed',
  'invalid_reason',
  'invalid_minutes',
  // the pending row vanished twice during the insert (cancelled or expired in parallel): retry later
  'busy',
] as const;
export const CANCEL_REQUEST_OUTCOMES = ['cancelled', 'not_found_or_not_pending'] as const;
export const END_OWN_GRANT_OUTCOMES = ['ended', 'no_active_grant'] as const;
export const BEGIN_FILE_ISSUE_OUTCOMES = ['ok', 'not_allowed', 'no_active_grant', 'file_limit', 'too_soon'] as const;
export const ANSWER_REQUEST_OUTCOMES = [
  'approved',
  'denied',
  'not_owner',
  'invalid_verdict',
  'not_found',
  'expired',
  'not_pending',
  'invalid_minutes',
  'invalid_target',
  'requester_not_allowed',
  'grant_conflict',
  // the competing grant ended between the failed insert and the lookup, twice in a row: retry later
  'busy',
] as const;
export const END_GRANT_OUTCOMES = ['revoked', 'not_owner', 'no_active_grant'] as const;

export async function requestRdpAccess(
  admin: AdminClient,
  input: { userId: string; reason: string; minutes: number; clientIp: string | null },
) {
  const row = firstRow<NullableExcept<RowOf<'rdp_request_access'>, 'outcome'>>(
    'request_access',
    await retryOnDeadlock(() => admin.rpc('rdp_request_access', {
      p_user_id: input.userId,
      p_reason: input.reason,
      p_minutes: input.minutes,
      p_client_ip: input.clientIp,
    })),
  );
  return {
    outcome: outcomeOf(row.outcome, REQUEST_ACCESS_OUTCOMES),
    requestId: row.request_id,
    expiresAt: row.expires_at,
  };
}

export async function cancelRdpRequest(admin: AdminClient, input: { userId: string; requestId: string }) {
  const row = firstRow<RowOf<'rdp_cancel_request'>>(
    'cancel_request',
    await retryOnDeadlock(() => admin.rpc('rdp_cancel_request', { p_user_id: input.userId, p_request_id: input.requestId })),
  );
  return { outcome: outcomeOf(row.outcome, CANCEL_REQUEST_OUTCOMES) };
}

export async function endOwnRdpGrant(admin: AdminClient, input: { userId: string }) {
  const row = firstRow<NullableExcept<RowOf<'rdp_end_own_grant'>, 'outcome'>>(
    'end_own_grant',
    await retryOnDeadlock(() => admin.rpc('rdp_end_own_grant', { p_user_id: input.userId })),
  );
  return { outcome: outcomeOf(row.outcome, END_OWN_GRANT_OUTCOMES), grantId: row.grant_id };
}

/** Reserves one download of the active grant. The caller then asks the gateway for the file. */
export async function beginRdpFileIssue(admin: AdminClient, input: { userId: string; clientIp: string | null }) {
  const row = firstRow<NullableExcept<RowOf<'rdp_begin_file_issue'>, 'outcome'>>(
    'begin_file_issue',
    await retryOnDeadlock(() => admin.rpc('rdp_begin_file_issue', { p_user_id: input.userId, p_client_ip: input.clientIp })),
  );
  return {
    outcome: outcomeOf(row.outcome, BEGIN_FILE_ISSUE_OUTCOMES),
    grantId: row.grant_id,
    target: row.target,
    expiresAt: row.expires_at,
    filesLeft: row.files_left,
  };
}

export type RdpAnswerInput = { requestId: string; actorId: string; note: string; context: Json } & (
  | { verdict: 'approved'; minutes: number; target: string }
  | { verdict: 'denied' }
);

/**
 * The owner's decision. `actorId` must be an owner (verified inside the function). The deny path ignores
 * minutes and target, so the generated non-null argument types are satisfied with 0 and ''.
 */
export async function answerRdpRequest(admin: AdminClient, input: RdpAnswerInput) {
  const row = firstRow<NullableExcept<RowOf<'rdp_answer_request'>, 'outcome'>>(
    'answer_request',
    await retryOnDeadlock(() => admin.rpc('rdp_answer_request', {
      p_request_id: input.requestId,
      p_actor_id: input.actorId,
      p_verdict: input.verdict,
      p_minutes: input.verdict === 'approved' ? input.minutes : 0,
      p_target: input.verdict === 'approved' ? input.target : '',
      p_note: input.note,
      p_context: input.context,
    })),
  );
  return {
    outcome: outcomeOf(row.outcome, ANSWER_REQUEST_OUTCOMES),
    grantId: row.grant_id,
    expiresAt: row.expires_at,
    conflictingGrantId: row.conflicting_grant_id,
  };
}

export async function endRdpGrant(admin: AdminClient, input: { actorId: string; grantId?: string; reason?: string }) {
  const row = firstRow<NullableExcept<RowOf<'rdp_end_grant'>, 'outcome'>>(
    'end_grant',
    await retryOnDeadlock(() => admin.rpc('rdp_end_grant', {
      p_actor_id: input.actorId,
      p_grant_id: input.grantId,
      p_reason: input.reason,
    })),
  );
  return { outcome: outcomeOf(row.outcome, END_GRANT_OUTCOMES), grantId: row.grant_id };
}

/**
 * The per-tunnel check the gateway makes (through the app's internal route). `allow` is true ONLY for a
 * literal `true`; anything else, including a database error, is a refusal at the call site.
 */
export async function checkRdpTunnel(
  admin: AdminClient,
  input: { target: string; clientIp: string | null; tunnelRef: string },
) {
  const row = firstRow<NullableExcept<RowOf<'rdp_check_tunnel'>, 'allow'>>(
    'check_tunnel',
    await retryOnDeadlock(() => admin.rpc('rdp_check_tunnel', {
      p_target: input.target,
      p_client_ip: input.clientIp,
      p_tunnel_ref: input.tunnelRef,
    })),
  );
  return { allow: row.allow === true, grantId: row.grant_id, expiresAt: row.expires_at };
}

export async function sweepRdpAccess(admin: AdminClient) {
  const row = firstRow<RowOf<'rdp_sweep'>>('sweep', await retryOnDeadlock(() => admin.rpc('rdp_sweep', {})));
  return {
    requestsExpired: row.requests_expired,
    grantsExpired: row.grants_expired,
    accessRemoved: row.access_removed,
  };
}

/** Records the result of one disconnect attempt for a grant that has already ended. */
export async function markRdpCut(admin: AdminClient, input: { grantId: string; ok: boolean; errorCode: string }) {
  const { error } = await retryOnDeadlock(() => admin.rpc('rdp_mark_cut', {
    p_grant_id: input.grantId,
    p_ok: input.ok,
    p_error_code: input.errorCode,
  }));
  if (error) throw new RdpAccessServiceError('mark_cut');
}

/**
 * True when a grant is live right now (there is at most one). An expired grant the sweep has not marked yet
 * (its row was locked elsewhere) is NOT live, so it is filtered by expires_at as well as by status.
 */
export async function hasActiveRdpGrant(admin: AdminClient, now: Date): Promise<boolean> {
  const { data, error } = await admin
    .from('rdp_access_grants')
    .select('id')
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .limit(1);
  if (error) throw new RdpAccessServiceError('has_active_grant');
  return data.length > 0;
}

/**
 * Ended grants whose gateway tunnels are not yet confirmed cut, and that are due another attempt
 * (the second confirming disconnect waits RDP_CUT_RETRY_AFTER_SECONDS after the first).
 */
export async function listRdpGrantsNeedingCut(admin: AdminClient, now: Date) {
  const since = new Date(now.getTime() - RDP_CUT_WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await admin
    .from('rdp_access_grants')
    .select('id, last_cut_at, cut_attempts')
    .neq('status', 'active')
    .is('tunnels_cut_at', null)
    .gt('ended_at', since)
    .lt('cut_attempts', RDP_CUT_MAX_ATTEMPTS);
  if (error) throw new RdpAccessServiceError('list_cut_pending');
  const dueBefore = now.getTime() - RDP_CUT_RETRY_AFTER_SECONDS * 1000;
  return data
    .filter((g) => g.last_cut_at === null || Date.parse(g.last_cut_at) <= dueBefore)
    .map((g) => ({ grantId: g.id, cutAttempts: g.cut_attempts }));
}
