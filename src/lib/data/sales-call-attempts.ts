import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { CONSOLE_DIAL_AUDIT_ACTION } from '@/lib/data/console-calls';
import type { CallbackPolicy } from '@/lib/callbacks/schedule-policy';
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/supabase/types';
// Request-FREE service-role DAL for sales_call_attempts — the Voximplant
// token/dispatch-bookkeeping table for the sales-closing agent's outbound
// call on a callback_requests row (topic = 'מכירות'). See that table's own
// migration comment (20260822104725) for why it carries NO outcome column:
// unlike callback_request_attempts (a confirmation PING ahead of a separate
// human call), this call IS the substantive interaction — its outcome is
// written directly to callback_requests.call_outcome via the existing
// applyCallOutcome(), a SEPARATE code path this file does not touch.
//
// This file is the DISPATCH-mechanics half only: whether the call itself was
// placed. It never calls applyCallOutcome and never WRITES outcome_recorded_at
// (the replay-guard column added by
// 20260822105346_sales_call_attempts_outcome_claim_guard.sql for the
// log_outcome/webhook/timeout-sweep write paths) — those routes are separate,
// pending auth-authz-guardian's outcome-write review, and are not built here.
// getUnresolvedSalesAttempt below is the one exception that READS the column
// (never claims/writes it) — see its own doc comment.
//
// Never logs access_token.

type AttemptRow = Tables<'sales_call_attempts'>;
type AttemptInsert = TablesInsert<'sales_call_attempts'>;

// Mirrors call_attempts' own PRE_TERMINAL and callback_request_attempts'
// DISPATCH_PRE_TERMINAL exactly.
export const DISPATCH_PRE_TERMINAL = ['queued', 'dialing', 'in_progress'] as const;

export type CreateSalesDispatchAttemptInput = {
  callbackRequestId: string;
  accessToken: string;
  tokenExpiresAt: string; // ISO timestamptz
  scheduledAtSnapshot: string; // ISO — callback_requests.scheduled_at at dispatch time
};

// Atomic dispatch-side create. Unlike callback_request_attempts,
// sales_call_attempts_request_slot_uidx is a PLAIN (non-partial) unique
// index on (callback_request_id, scheduled_at_snapshot) — confirmed with
// voximplant-engineer per the migration's own comment: every row here is
// dispatch-originated (no issued_via discriminator), and a same-slot retry
// after failed_to_start is deliberately NOT supported (StartScenarios is
// never blind-retried; see core.ts). A plain index has no partial-predicate
// inference problem, so createCallAttempt's own upsert()+ignoreDuplicates
// idiom applies verbatim here — unlike callback-request-attempts.ts, which
// needed the insert+catch-23505 workaround specifically because ITS index is
// partial.
export async function createSalesDispatchAttempt(
  input: CreateSalesDispatchAttemptInput,
): Promise<{ id: string } | null> {
  const admin = createAdminClient();
  const row: AttemptInsert = {
    callback_request_id: input.callbackRequestId,
    access_token: input.accessToken,
    token_expires_at: input.tokenExpiresAt,
    scheduled_at_snapshot: input.scheduledAtSnapshot,
    // Defaults to 'queued' on the table, but this row is dialed in the SAME
    // tick it is created — write 'dialing' directly, matching
    // createCallAttempt's identical choice for call_attempts.
    dispatch_status: 'dialing',
  };
  const { data, error } = await admin
    .from('sales_call_attempts')
    .upsert(row, {
      onConflict: 'callback_request_id,scheduled_at_snapshot',
      ignoreDuplicates: true,
    })
    .select('id')
    .maybeSingle();
  if (error) throw new Error('יצירת ניסיון שיחת המכירה נכשלה');
  if (!data) return null;
  return { id: data.id };
}

// Reconcile read for a lost createSalesDispatchAttempt race — the exact
// (callback_request_id, scheduled_at_snapshot) pair the unique index guards.
export async function getSalesDispatchAttemptBySlot(
  callbackRequestId: string,
  scheduledAtSnapshot: string,
): Promise<AttemptRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sales_call_attempts')
    .select('*')
    .eq('callback_request_id', callbackRequestId)
    .eq('scheduled_at_snapshot', scheduledAtSnapshot)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון שיחת המכירה נכשלה');
  return data;
}

// Record a CONFIRMED StartScenarios start. Does NOT change dispatch_status —
// same reasoning as recordCallbackDialConfirmed in
// callback-request-attempts.ts and recordDialConfirmed in call-attempts.ts:
// the row stays pre-terminal until a real terminal signal arrives, which for
// THIS table is the not-yet-built log_outcome route's dispatch-status write
// (a separate concern from the outcome it also writes to callback_requests).
export async function recordSalesDialConfirmed(
  id: string,
  callSessionHistoryId: number,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sales_call_attempts')
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
    .from('sales_call_attempts')
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

// Definite provider rejection (VoximplantApiError). Non-retryable — see
// createSalesDispatchAttempt's own doc comment on why a same-slot retry is
// deliberately not supported by this table's uniqueness. A row a crashed
// process left stuck at 'dialing' forever is now covered by
// runSalesDispatchReconcile (voximplant-reconcile.ts, extended 2026-08-22) —
// ALERT-ONLY, same caveat as callback-request-attempts.ts's identical note.
export async function markSalesDispatchFailed(
  id: string,
  reason: string,
): Promise<{ applied: boolean }> {
  return recordDispatchOutcome(id, 'failed_to_start', reason);
}

// Ambiguous StartScenarios outcome. NEVER triggers a redial.
export async function markSalesDispatchUnknown(
  id: string,
  reason: string,
): Promise<{ applied: boolean }> {
  return recordDispatchOutcome(id, 'start_unknown', reason);
}

// Cross-slot guard: does this callback_request_id have a PRIOR dispatched
// call whose outcome hasn't been claimed yet? Unlike
// getSalesDispatchAttemptBySlot (scoped to one exact (callback_request_id,
// scheduled_at_snapshot) pair — a same-slot retry), this checks ACROSS every
// scheduled_at_snapshot for this request. Real gap this closes: an admin can
// call rescheduleCallbackRequest() on a 'scheduled' row at any time — it sets
// status='needs_reschedule' and clears calendar_item_id (callback-
// scheduling.ts) — after which runCallbackSchedulingSweep finds a NEW slot
// and the row returns to status='scheduled' with a NEW scheduled_at. That is
// a new, unconflicting sales_call_attempts_request_slot_uidx key, so the
// unique index does nothing to stop a second real dial while the FIRST
// call's async outcome (WhatsApp/SMS delivery confirmation, or a pending
// log_outcome) is still unresolved. Filtering on vox_call_session_history_id
// IS NOT NULL means a genuine failed_to_start/start_unknown prior attempt
// (never actually dialed) does NOT block a retry on the new slot — only a
// call that really went out and hasn't been claimed does. Read-only: never
// writes outcome_recorded_at (see file header).
export async function getUnresolvedSalesAttempt(
  callbackRequestId: string,
): Promise<AttemptRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sales_call_attempts')
    .select('*')
    .eq('callback_request_id', callbackRequestId)
    .not('vox_call_session_history_id', 'is', null)
    .is('outcome_recorded_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('בדיקת שיחת מכירה פתוחה נכשלה');
  return data;
}

// Looks up the attempt for a given ElevenLabs conversation id, falling back to
// the non-authorizing sales attempt id injected as kalfa_attempt_token. The
// fallback keeps the post-call webhook's catch-all outcome path working even if
// Voximplant misses the terminal cb that writes el_conversation_id.
export async function getSalesAttemptIdByConversationId(
  elConversationId: string,
  correlationToken?: string | null,
): Promise<{ id: string; callbackRequestId: string } | null> {
  const admin = createAdminClient();
  const select = 'id, callback_request_id';

  if (correlationToken && /^[0-9a-f-]{36}$/i.test(correlationToken)) {
    const { data, error } = await admin
      .from('sales_call_attempts')
      .select(select)
      .eq('id', correlationToken)
      .maybeSingle();
    if (error) throw new Error('אחזור ניסיון שיחת מכירה לפי מזהה קורלציה נכשל');
    if (data) return { id: data.id, callbackRequestId: data.callback_request_id };
  }

  const { data, error } = await admin
    .from('sales_call_attempts')
    .select(select)
    .eq('el_conversation_id', elConversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('אחזור ניסיון שיחת מכירה לפי מזהה שיחה נכשל');
  return data ? { id: data.id, callbackRequestId: data.callback_request_id } : null;
}

// Durable concurrency counter — the sales-dispatch half of the combined
// cross-table count. Never call this alone to enforce a concurrency cap; see
// voximplant-concurrency.ts.
export async function countActiveSalesDispatches(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('sales_call_attempts')
    .select('id', { count: 'exact', head: true })
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[]);
  if (error) throw new Error('count_active_sales_dispatches_failed');
  return count ?? 0;
}

// Same attempt cap / same audit-action shape as callback-request-attempts.ts's
// countRecentCallbackAuditedAttempts — see that function's own doc comment for
// the identical reasoning, including the CONFIRMED gap that today's admin
// tel:-link dial (a plain <a href="tel:">, zero server round-trip) is not
// counted toward this cap at all.
//
// cap/window are admin-editable (CallbackPolicy.maxAttempts/attemptWindowMs,
// /admin/callbacks/policy as of 31.8) — the caller fetches the policy once
// and passes it in, rather than this function re-fetching it per call.
export async function countRecentSalesAuditedAttempts(
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
  if (error) return policy.maxAttempts; // unreadable ⇒ treat as capped (fail-closed)
  return count ?? 0;
}

// Write the SAME audit action a human console dial writes, so a
// sales-closing AI dial is visible to the same budget a
// meeting-confirmation AI dial (and any human dial that writes it) already
// shares for this callback_request_id.
export async function recordSalesDialAudit(callbackRequestId: string): Promise<void> {
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

// --- sls/ctx|cb|tool voice-token surface — mirrors callback-request-attempts.ts's
// mtg/ctx|cb section exactly, keyed to sales_call_attempts instead. ---

export type SalesVoiceContext = {
  attempt: Pick<
    AttemptRow,
    'id' | 'callback_request_id' | 'token_expires_at' | 'scheduled_at_snapshot' | 'el_conversation_id'
  >;
  request: {
    full_name: string;
    note: string | null;
    topic: string | null;
    status: string;
    scheduled_at: string | null;
  };
};

const SALES_VOICE_CTX_SELECT =
  'id, callback_request_id, token_expires_at, scheduled_at_snapshot, el_conversation_id';

// Branch B (ctx endpoint). Freshness re-verification (status/scheduled_at vs
// snapshot) is deliberately left to the ROUTE, same discipline as
// getCallbackVoiceContextByAccessToken's own comment — a DAL null must not
// conflate "no such token" with "found but stale".
export async function getSalesVoiceContextByAccessToken(
  accessToken: string,
): Promise<SalesVoiceContext | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from('sales_call_attempts')
    .select(SALES_VOICE_CTX_SELECT)
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון שיחת המכירה נכשלה');
  if (!attempt) return null;

  const { data: request, error: reqErr } = await admin
    .from('callback_requests')
    .select('full_name, note, topic, status, scheduled_at')
    .eq('id', attempt.callback_request_id)
    .maybeSingle();
  if (reqErr) throw new Error('טעינת בקשת ההתקשרות נכשלה');
  if (!request) return null;

  return { attempt, request };
}

// Branch B (cb + tool endpoints): resolve id + expiry only. Identity for
// every sls/tool/* and sls/cb call ALWAYS comes from this lookup — never
// from the POSTed body.
export async function getSalesAttemptByAccessToken(
  accessToken: string,
): Promise<{ id: string; callback_request_id: string; token_expires_at: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sales_call_attempts')
    .select('id, callback_request_id, token_expires_at')
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון שיחת המכירה נכשלה');
  return data ?? null;
}

// Resolve the parent callback_requests row's contact fields for a tool-call
// processing function (send_signup_link needs the phone; escalate_to_human /
// notify_owner-equivalents need full_name) — mirrors
// getCallbackRequestForAttempt exactly.
export async function getSalesRequestForAttempt(attemptId: string): Promise<{
  callbackRequestId: string;
  fullName: string;
  phone: string;
  topic: string | null;
} | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from('sales_call_attempts')
    .select('callback_request_id')
    .eq('id', attemptId)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון שיחת המכירה נכשלה');
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

// The scenario's OWN terminal-lifecycle report (sls/cb) — moves
// dispatch_status to 'concluded' so the row stops consuming a concurrency
// slot. Mirrors recordCallbackDispatchConcluded exactly.
export async function recordSalesDispatchConcluded(
  id: string,
  finishReason: string,
  callDurationSec: number | null,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sales_call_attempts')
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

export async function setSalesAttemptElConversationId(
  id: string,
  elConversationId: string,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sales_call_attempts')
    .update({ el_conversation_id: elConversationId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום מזהה השיחה נכשל');
  return { applied: data !== null };
}

// Single-use claim guard for the FOUR outcome-write paths this table shares
// (file header) — every one of them must claim `outcome_recorded_at` in the
// SAME statement immediately before calling applyCallOutcome. Returns the
// parent callback_request_id so the caller never needs a second lookup.
export async function claimSalesOutcome(
  attemptId: string,
): Promise<{ callbackRequestId: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sales_call_attempts')
    .update({ outcome_recorded_at: new Date().toISOString() })
    .eq('id', attemptId)
    .is('outcome_recorded_at', null)
    .select('callback_request_id')
    .maybeSingle();
  if (error) throw new Error('רישום תוצאת השיחה נכשל');
  return data ? { callbackRequestId: data.callback_request_id } : null;
}

// Best-effort bookkeeping for a send_signup_link call — never gates the
// tool's own response (see the route's own comment). A lost write here only
// degrades future WhatsApp-delivery-webhook correlation, which is out of
// this build's scope (see sales-closing script draft §7).
//
// waDeliveryStatus/waDeliveryErrorCode/waFallbackAttemptedAt capture WHY a
// WhatsApp attempt did not yield a message id (sendWhatsAppMarketingTemplate's
// own DeliveryOutcome.kind/reason/providerCode) — until 31.8 this was computed
// and then discarded by the route on every non-accepted outcome, so a silent
// WhatsApp rejection (e.g. a Meta error code) left zero trace anywhere: not
// Slack (alertWhatsAppThrow deliberately only fires on a THROW, never on a
// classified provider error — see that function's own comment), not the DB.
export async function recordSalesLinkSent(
  id: string,
  fields: {
    waConsentConfirmedAt?: string;
    waMessageId?: string;
    waDeliveryStatus?: string;
    waDeliveryErrorCode?: string;
    waFallbackAttemptedAt?: string;
  },
): Promise<void> {
  try {
    const admin = createAdminClient();
    const update: TablesUpdate<'sales_call_attempts'> = {
      updated_at: new Date().toISOString(),
    };
    if (fields.waConsentConfirmedAt) update.wa_consent_confirmed_at = fields.waConsentConfirmedAt;
    if (fields.waMessageId) update.wa_message_id = fields.waMessageId;
    if (fields.waDeliveryStatus) update.wa_delivery_status = fields.waDeliveryStatus;
    if (fields.waDeliveryErrorCode) update.wa_delivery_error_code = fields.waDeliveryErrorCode;
    if (fields.waFallbackAttemptedAt) update.wa_fallback_attempted_at = fields.waFallbackAttemptedAt;
    await admin.from('sales_call_attempts').update(update).eq('id', id);
  } catch {
    // Deliberately swallowed — bookkeeping only, never blocks the tool response.
  }
}

// Meta's ASYNCHRONOUS delivery report (sent/delivered/read/failed) for a signup
// link already sent. A different event from recordSalesLinkSent above, which
// stores what Meta answered SYNCHRONOUSLY at send time: the message id proves
// Meta accepted the message, never that a person received or read it.
//
// MEASURED 2026-09-01, on the first sales call that ever sent a link: Meta
// delivered all three reports (sent 01:24:26, delivered 01:24:43, read
// 01:24:53), the inbox stored all three, and processStatus marked all three
// processed with no error — while wa_status_at stayed NULL, because NOTHING in
// the codebase wrote that column. The reports were received and then landed
// nowhere.
//
// Why this lives here rather than routing sales sends through
// contact_interactions like every guest message does: that table is the
// guest-messaging ledger. Its rows carry contact_id/event_id and feed campaign
// delivery state and reached-contact billing (campaign-delivery.ts,
// guests.ts). A sales lead is not a contact and has no event — callback_requests
// and contacts share no key at all — so a sales send there would be a
// contact-less, event-less row inside a ledger that billing reads. This is the
// additive alternative: the same webhook, one extra lookup by wamid, no shared
// table touched.
//
// Last-write-wins, deliberately matching setDeliveryStatus's behaviour for
// guest messages rather than inventing different semantics for the same kind of
// event: a retry arriving out of order can move the display backwards.
// wa_status_at carries the EVENT's own instant (not now()), so the screen shows
// when Meta says it happened.
export async function recordSalesWaDeliveryStatus(
  messageId: string,
  status: string,
  errorCode: string | null,
  eventAt: string | null,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from('sales_call_attempts')
      .update({
        wa_delivery_status: status,
        wa_delivery_error_code: errorCode,
        wa_status_at: eventAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('wa_message_id', messageId);
  } catch {
    // Bookkeeping only. A sales attempt this status does not belong to simply
    // matches no row — the ordinary case, since most statuses are guest
    // messages — and must never fail the webhook for everyone else.
  }
}
