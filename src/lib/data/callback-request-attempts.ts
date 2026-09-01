import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { CONSOLE_DIAL_AUDIT_ACTION } from '@/lib/data/console-calls';
import type { CallbackPolicy } from '@/lib/callbacks/schedule-policy';
import type { Tables, TablesInsert } from '@/lib/supabase/types';
// Request-FREE service-role DAL for callback_request_attempts — the
// Voximplant token/dispatch-bookkeeping table parallel to call_attempts, but
// scoped to callback_requests (meeting-confirmation/reschedule calls; see
// that table's own migration comment for why call_attempts itself is not
// reusable — no campaign/event/guest concept exists for this flow). Consumed
// today only by meeting-confirm-dispatch.ts; the ctx/cb route handlers that
// will read access_token are a separate, security-reviewed piece of work
// (public-rsvp-sentinel), not built yet — so this file never surfaces
// access_token to anything, only writes it.
//
// Never logs access_token. dispatch_status is a SEPARATE axis from
// confirmation_call_status (the call's semantic result, written later by
// whatever calls the not-yet-built mtg/cb route) — see the dispatch-lifecycle
// migration's own comment for the full reasoning; this file only ever touches
// dispatch_status.

type AttemptRow = Tables<'callback_request_attempts'>;
type AttemptInsert = TablesInsert<'callback_request_attempts'>;

// Mirrors call_attempts' own PRE_TERMINAL exactly (call-attempts.ts) — the
// dispatch_status CHECK constraint's pre-terminal subset. Used for the
// concurrency count and every CAS-guarded update below.
export const DISPATCH_PRE_TERMINAL = ['queued', 'dialing', 'in_progress'] as const;

export type CreateCallbackDispatchAttemptInput = {
  callbackRequestId: string;
  accessToken: string; // opaque per-call nonce (unique)
  tokenExpiresAt: string; // ISO timestamptz
  scheduledAtSnapshot: string; // ISO — callback_requests.scheduled_at at issuance
};

// Atomic dispatch-side create (plan SS11a).
//
// callback_request_attempts_dispatch_slot_uidx is a PARTIAL unique index —
// `(callback_request_id, scheduled_at_snapshot) WHERE issued_via='dispatch'`.
// call_attempts' own createCallAttempt targets its (non-partial) unique
// constraint via `.upsert(row, {onConflict, ignoreDuplicates:true})`, but that
// idiom cannot be reused here: PostgREST's `on_conflict` parameter only ever
// carries a column list, and Postgres will not infer a PARTIAL unique index
// as an ON CONFLICT arbiter without the matching WHERE predicate present in
// the ON CONFLICT clause itself (raises 42P10 otherwise) — there is no way to
// express that predicate through supabase-js's upsert() call shape.
//
// A plain `.insert()` that lets a genuine collision raise 23505
// (unique_violation) and catches it is therefore not a stylistic choice but
// the only correct primitive against a partial unique index — and it already
// has precedent in this codebase (event-exchange-sync.ts's
// exchange_calendar_links_event_unique, exchange-connections.ts's
// exchange_connections_mailbox_per_user): both use exactly this insert+catch
// shape, not upsert(), for the same underlying reason.
export async function createCallbackDispatchAttempt(
  input: CreateCallbackDispatchAttemptInput,
): Promise<{ id: string } | null> {
  const admin = createAdminClient();
  const row: AttemptInsert = {
    callback_request_id: input.callbackRequestId,
    issued_via: 'dispatch',
    access_token: input.accessToken,
    token_expires_at: input.tokenExpiresAt,
    scheduled_at_snapshot: input.scheduledAtSnapshot,
    // Defaults to 'queued' on the table, but this row is dialed in the SAME
    // tick it is created (no queueing layer sits between this call and
    // StartScenarios) — write 'dialing' directly, the same choice
    // createCallAttempt already makes for call_attempts.
    dispatch_status: 'dialing',
  };
  const { data, error } = await admin
    .from('callback_request_attempts')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') return null; // lost the race
    throw new Error('יצירת ניסיון שיחת האישור נכשלה');
  }
  return { id: data.id };
}

// All dispatch attempts for one slot — the exact
// (callback_request_id, scheduled_at_snapshot) pair the partial unique index
// guards, scoped to issued_via='dispatch' so an inbound_identification row
// for the same request (a different logical attempt, minted by the
// inbound-answering agent) can never be mistaken for a dispatch attempt.
// A LIST since 2026-08-23: the in-flight-only unique index
// (callback_request_attempts_dispatch_slot_inflight_uidx) allows multiple
// TERMINAL attempts per slot — a call that concluded without any semantic
// outcome (confirmation_call_status='not_sent') no longer occupies the slot
// forever (that exact shape suppressed the scheduled 09:00 retry and left a
// meeting unconfirmed, incident 2026-08-23). Newest first.
export async function listCallbackDispatchAttemptsBySlot(
  callbackRequestId: string,
  scheduledAtSnapshot: string,
): Promise<AttemptRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .select('*')
    .eq('callback_request_id', callbackRequestId)
    .eq('scheduled_at_snapshot', scheduledAtSnapshot)
    .eq('issued_via', 'dispatch')
    .order('created_at', { ascending: false });
  if (error) throw new Error('טעינת ניסיונות שיחת האישור נכשלה');
  return data ?? [];
}

// Record a CONFIRMED StartScenarios start (result===1 && call_session_history_id).
// Does NOT change dispatch_status — mirrors recordDialConfirmed's own
// reasoning in call-attempts.ts: the row stays pre-terminal until a real
// terminal signal arrives. Today nothing writes that signal yet (the mtg/cb
// route is separate, not-yet-built, security-reviewed work) — this dispatcher
// only ever gets the row as far as "confirmed dialing", never "concluded".
// Guarded so an already-past-pre-terminal row can never be clobbered.
export async function recordCallbackDialConfirmed(
  id: string,
  callSessionHistoryId: number,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .update({
      vox_call_session_history_id: String(callSessionHistoryId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום אימות החיוג נכשל');
  return { applied: data !== null };
}

async function recordDispatchOutcome(
  id: string,
  status: 'failed_to_start' | 'start_unknown',
  reason: string,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .update({
      dispatch_status: status,
      finish_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום תוצאת השיגור נכשל');
  return { applied: data !== null };
}

// Definite provider rejection (VoximplantApiError). Non-retryable — mirrors
// markFailedToStart's reasoning in call-attempts.ts exactly: StartScenarios
// is never blind-retried (core.ts), so this is terminal for THIS attempt.
// A row a crashed process left stuck at 'dialing' forever is now covered:
// runCallbackDispatchReconcile (voximplant-reconcile.ts, extended 2026-08-22)
// Slack-alerts on any pre-terminal row here older than 15m — ALERT-ONLY, it
// never mutates this table or re-issues StartScenarios, so a stuck row still
// silently consumes one concurrency-cap slot (voximplant-concurrency.ts)
// until a human closes it.
export async function markCallbackDispatchFailed(
  id: string,
  reason: string,
): Promise<{ applied: boolean }> {
  return recordDispatchOutcome(id, 'failed_to_start', reason);
}

// Ambiguous StartScenarios outcome (network/timeout/5xx-after-send/
// result!==1/result===1 without a history id). NEVER triggers a redial.
export async function markCallbackDispatchUnknown(
  id: string,
  reason: string,
): Promise<{ applied: boolean }> {
  return recordDispatchOutcome(id, 'start_unknown', reason);
}

// The scenario's OWN terminal lifecycle report (mtg/cb/[token], NOT the
// mtg/tool/* agent-tool routes) — mirrors RSVPAgent's cb/[token] terminal
// callback: the call session ended, one way or another. dispatch_status
// moves to 'concluded' regardless of WHY the call ended (answered, no
// answer, voicemail, bad line) — the semantic OUTCOME lives on
// confirmation_call_status (a separate axis, written by claimCallbackVoiceOutcome
// via the mtg/tool/* routes during the call, or left at 'not_sent' when the
// call never got that far). Guarded exactly like recordDispatchOutcome: only
// applies from a pre-terminal dispatch_status, so a duplicate/late report
// can never clobber an already-concluded row.
export async function recordCallbackDispatchConcluded(
  id: string,
  finishReason: string,
  callDurationSec: number | null,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .update({
      dispatch_status: 'concluded',
      finish_reason: finishReason,
      call_duration_sec: callDurationSec,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום סיום השיחה נכשל');
  return { applied: data !== null };
}

// ADDITIVE, best-effort (mirrors call-attempts.ts's setElConversationId): the
// scenario's terminal report may carry the ElevenLabs conversation_id
// captured earlier from ConversationInitiationMetadata. Not gated on
// dispatch_status — a late/duplicate report should still be able to fill
// this in if the earlier attempt somehow missed it.
export async function setCallbackAttemptElConversationId(
  id: string,
  elConversationId: string,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .update({ el_conversation_id: elConversationId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום מזהה השיחה נכשל');
  return { applied: data !== null };
}

// Durable concurrency counter — the callback-dispatch half of the combined
// cross-table count. Never call this alone to enforce a concurrency cap; see
// voximplant-concurrency.ts's countActiveCallsAllSurfaces for why.
export async function countActiveCallbackDispatches(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('callback_request_attempts')
    .select('id', { count: 'exact', head: true })
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[]);
  if (error) throw new Error('count_active_callback_dispatches_failed');
  return count ?? 0;
}

// The same attempt cap that already protects this callback_requests row
// against repeated human console dials (console-calls.ts's module-private
// countRecentCallbackDialAttempts, counting activity_log rows with
// action=CONSOLE_DIAL_AUDIT_ACTION and meta->>callback_request_id). This is a
// SEPARATE query against the identical action string and window — imported,
// not duplicated logic — so a row written by recordCallbackDialAudit below is
// visible to it.
//
// cap/window are admin-editable (CallbackPolicy.maxAttempts/attemptWindowMs,
// /admin/callbacks/policy as of 31.8) — the caller fetches the policy once
// and passes it in, rather than this function re-fetching it per call.
//
// CONFIRMED (team-lead, 2026-08-22): the admin's tel: link on
// /admin/callbacks/[id] is a plain browser `<a href="tel:...">` — zero server
// round-trip when clicked, structurally cannot write CONSOLE_DIAL_AUDIT_ACTION
// (that write only happens via recordConsoleDialAudit, called only from the
// browser-softphone dial-intent flow). A staff member manually dialing via
// that link today is NOT counted toward the attempt cap at all — only
// softphone-flow calls are. This dispatcher writes the row regardless (the
// safer default for the AI-dial path this file owns), but the attempt
// counter is operationally undercounting real human attempts today wherever
// staff use the tel: link instead of the softphone — independent of anything
// AI-related, not something this file can fix.
export async function countRecentCallbackAuditedAttempts(
  callbackRequestId: string,
  nowMs: number,
  policy: CallbackPolicy,
): Promise<number> {
  const admin = createAdminClient();
  const sinceIso = new Date(nowMs - policy.attemptWindowMs).toISOString();
  const { count, error } = await admin
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', CONSOLE_DIAL_AUDIT_ACTION)
    .eq('meta->>callback_request_id', callbackRequestId)
    .gte('created_at', sinceIso);
  if (error) return policy.maxAttempts; // unreadable ⇒ treat as capped (fail-closed, matches console-calls.ts)
  return count ?? 0;
}

// Write the SAME audit action a human console dial writes
// (recordConsoleDialAudit in console-calls.ts), so an AI-dispatched call
// becomes visible to whatever already reads CONSOLE_DIAL_AUDIT_ACTION rows
// for this callback_request_id — including countRecentCallbackAuditedAttempts
// above. user_id is null (no human agent chose this dial; a null user_id is
// the same convention recordRsvpFromCall/recordManualDialOutcome already use
// for a system-initiated activity_log row). Best-effort: a lost write
// degrades a cap's visibility for future dials, never the call that already
// happened.
export async function recordCallbackDialAudit(callbackRequestId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    type ActivityLogInsert = TablesInsert<'activity_log'>;
    const row: ActivityLogInsert = {
      event_id: null,
      user_id: null,
      action: CONSOLE_DIAL_AUDIT_ACTION,
      meta: { callback_request_id: callbackRequestId } as ActivityLogInsert['meta'],
    };
    await admin.from('activity_log').insert(row);
  } catch {
    // Deliberately swallowed — see doc comment.
  }
}

// --- mtg/ctx|cb voice-token surface (public-rsvp-sentinel-reviewed 2026-08-22) ---
//
// The functions below are what the ctx/[token] and cb/[token] route handlers
// use — the piece this file's original header comment named as "a separate,
// security-reviewed piece of work, not built yet". Now reviewed and built.

export type CallbackVoiceContext = {
  attempt: Pick<
    AttemptRow,
    'id' | 'callback_request_id' | 'token_expires_at' | 'scheduled_at_snapshot' | 'el_conversation_id'
  >;
  request: {
    full_name: string;
    topic: string | null;
    status: string;
    scheduled_at: string | null;
    calendar_item_id: string | null;
  };
};

const VOICE_CTX_SELECT =
  'id, callback_request_id, token_expires_at, scheduled_at_snapshot, el_conversation_id';

// Branch B (ctx endpoint): resolve the attempt + the live callback_requests row
// from the opaque access_token. Identity ALWAYS comes from this server-side
// lookup — same discipline as call-attempts.ts's getCallContextByAccessToken.
// Two sequential queries, not an embedded join — matches that file's own
// pattern exactly (hydrateCallContext), not a stylistic choice.
//
// Deliberately does NOT re-verify freshness here (status/calendar_item_id/
// scheduled_at-vs-snapshot) — that is the ROUTE's job (review finding B3: the
// route must return the identical generic 404 for "not found" and "found but
// stale", so the freshness check has to live where that response is decided,
// not be silently baked into a DAL function that could return null for two
// different reasons a caller can't tell apart).
export async function getCallbackVoiceContextByAccessToken(
  accessToken: string,
): Promise<CallbackVoiceContext | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from('callback_request_attempts')
    .select(VOICE_CTX_SELECT)
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  if (!attempt) return null;

  const { data: request, error: reqErr } = await admin
    .from('callback_requests')
    .select('full_name, topic, status, scheduled_at, calendar_item_id')
    .eq('id', attempt.callback_request_id)
    .maybeSingle();
  if (reqErr) throw new Error('טעינת בקשת ההתקשרות נכשלה');
  if (!request) return null;

  return { attempt, request };
}

// Branch B (cb endpoint): resolve id + expiry only, same shape as
// getCallAttemptByAccessToken. Identity for the callback ALWAYS comes from
// this lookup — never from the POSTed body.
export async function getCallbackAttemptByAccessToken(
  accessToken: string,
): Promise<{ id: string; callback_request_id: string; token_expires_at: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .select('id, callback_request_id, token_expires_at')
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  return data ?? null;
}

// Resolve the parent callback_requests row's contact fields for a tool-call
// processing function (mtg/cb/*/[token]) — those need full_name/phone/topic,
// which the ctx/cb-oriented lookups above deliberately don't carry. Two
// sequential queries, same established convention as
// getCallbackVoiceContextByAccessToken (not a stylistic choice — see that
// function's comment).
export async function getCallbackRequestForAttempt(attemptId: string): Promise<{
  callbackRequestId: string;
  fullName: string;
  phone: string;
  topic: string | null;
} | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from('callback_request_attempts')
    .select('callback_request_id')
    .eq('id', attemptId)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  if (!attempt) return null;

  const { data: request, error: reqErr } = await admin
    .from('callback_requests')
    .select('full_name, phone, topic')
    .eq('id', attempt.callback_request_id)
    .maybeSingle();
  if (reqErr) throw new Error('טעינת בקשת ההתקשרות נכשלה');
  if (!request) return null;

  return {
    callbackRequestId: attempt.callback_request_id,
    fullName: request.full_name,
    phone: request.phone,
    topic: request.topic,
  };
}

// Single-use claim guard (review finding B2): callback_request_attempts has
// no outcome_recorded_at column (that's sales_call_attempts' fix, for a
// different reason). This table's replay protection is confirmation_call_status
// itself — a leaked/replayed cb token within its TTL must not be able to
// re-trigger rescheduleCallbackRequest/the DNC upsert more than once. Claim
// BEFORE calling either, exactly like sales_call_attempts.outcome_recorded_at
// — only proceed if a row comes back.
export async function claimCallbackVoiceOutcome(
  attemptId: string,
  status: 'confirmed' | 'reschedule_requested' | 'opted_out',
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .update({ confirmation_call_status: status, updated_at: new Date().toISOString() })
    .eq('id', attemptId)
    .eq('confirmation_call_status', 'not_sent')
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום תוצאת השיחה נכשל');
  return { applied: data !== null };
}
