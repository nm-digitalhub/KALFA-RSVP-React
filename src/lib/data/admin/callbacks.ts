import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  applyCallOutcome,
  closeCallbackAppointment,
  rescheduleCallbackRequest,
  type RescheduleOutcome,
} from '@/lib/data/callback-scheduling';
import type { Json, Tables } from '@/lib/supabase/types';
import {
  CALLBACK_TERMINAL_STATUSES,
  isCancellableCallbackStatus,
  type CallOutcome,
} from '@/lib/validation/admin';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: callback (call-me-back) requests. Authorized by the request-scoped
// session under the `cb_admin_all` RLS policy, plus a server-side requireAdmin()
// gate. `status` and `call_outcome` are free text in the DB; the UI constrains
// writes to the closed vocabularies in validation/admin.ts and renders
// unknown stored values via fallback.
//
// Two independent dimensions since the 2026-08-19/20 redesign (see
// validation/admin.ts for the full reasoning): `status` is the SCHEDULER's
// state (system-driven, admin only ever sets 'cancelled' — see
// cancelCallback), `call_outcome` is what the OWNER recorded after making the
// call (admin-set — see updateCallOutcome). Never conflate the two again.

type CallbackRow = Tables<'callback_requests'>;
type SalesCallAttemptRow = Tables<'sales_call_attempts'>;
type CallAnalysisRow = Tables<'call_analysis'>;

type MeetingConfirmAttemptRow = Tables<'callback_request_attempts'>;

type SalesCallAttemptSelect = Pick<
  SalesCallAttemptRow,
  | 'id'
  | 'callback_request_id'
  | 'dispatch_status'
  | 'scheduled_at_snapshot'
  | 'created_at'
  | 'updated_at'
  | 'vox_call_session_history_id'
  | 'finish_reason'
  | 'call_duration_sec'
  | 'el_conversation_id'
  | 'outcome_recorded_at'
  | 'signup_completed_at'
  | 'wa_message_id'
  | 'wa_delivery_status'
  | 'wa_delivery_error_code'
  | 'wa_status_at'
>;

// The columns BOTH attempt tables share, plus each one's own extras. The union
// is what mapAiCall reads; a field the other persona lacks is simply absent,
// never faked.
type MeetingConfirmAttemptSelect = Pick<
  MeetingConfirmAttemptRow,
  | 'id'
  | 'dispatch_status'
  | 'scheduled_at_snapshot'
  | 'created_at'
  | 'updated_at'
  | 'vox_call_session_history_id'
  | 'finish_reason'
  | 'call_duration_sec'
  | 'el_conversation_id'
  | 'confirmation_call_status'
>;

// Either persona's attempt, as PostgREST returns it with its analysis embedded.
type AiCallAttemptSelect = (Partial<SalesCallAttemptSelect> &
  Partial<MeetingConfirmAttemptSelect>) & {
  id: string;
  call_analysis?: unknown;
};

type CallAnalysisSelect = Pick<
  CallAnalysisRow,
  | 'conversation_id'
  | 'agent_id'
  | 'call_successful'
  | 'status'
  | 'el_call_score'
  | 'termination_reason'
  | 'call_duration_secs'
  | 'cost_credits'
  | 'agent_turns'
  | 'user_turns'
  | 'el_eval'
  | 'el_data'
  | 'analysis_at'
  | 'transcript_summary'
  | 'summary_title'
  | 'voicemail_detected'
  | 'sentiment_label'
  | 'frustration_score'
>;

export type CallbackRequest = Pick<
  CallbackRow,
  | 'id'
  | 'full_name'
  | 'phone'
  | 'topic'
  | 'note'
  | 'status'
  | 'call_outcome'
  | 'scheduled_at'
  | 'created_at'
  | 'updated_at'
>;

export const CALLBACK_COLUMNS =
  'id, full_name, phone, topic, note, status, call_outcome, scheduled_at, created_at, updated_at';

// The detail view adds the scheduling columns the list deliberately omits: a
// list is for triage, this is the screen the calendar item links to while the
// phone is already ringing.
export type CallbackRequestDetail = CallbackRequest &
  Pick<
    CallbackRow,
    | 'requested_at'
    | 'calendar_item_id'
    | 'attempt_count'
    | 'scheduling_failure_reason'
    | 'consecutive_no_answer_count'
  >;

export type CallAnalysisSuccessful = 'success' | 'failure' | 'unknown';
export type CallAnalysisStatus = 'done' | 'failed' | 'unknown';

export type SalesCallDataCollection = {
  callOutcome?: string | null;
  eventType?: string | null;
  estimatedGuestCount?: number | null;
  whatsappConsent?: boolean | null;
  objectionReason?: string | null;
};

/**
 * Which persona placed the call. The screen shows every AI call on a callback
 * in ONE list — a sales call and a meeting-confirmation call are both "an AI
 * call about this lead", and hiding either is how the owner ended up about to
 * phone a customer who had confirmed seven minutes earlier (measured
 * 2026-09-01). The source is what tells them apart on screen; it is NOT a
 * reason to split the list again.
 */
export type AiCallSource = 'sales' | 'meeting_confirm';

export type SalesCallCrmSummary = {
  source: AiCallSource;
  attemptId: string;
  callbackRequestId: string;
  dispatchStatus: string;
  attemptCreatedAt: string;
  attemptUpdatedAt: string;
  /** Nullable since 2026-09-01: the union covers two attempt tables. */
  scheduledAtSnapshot: string | null;
  finishReason: string | null;
  voxCallSessionHistoryId: string | null;
  elConversationId: string | null;
  outcomeRecordedAt: string | null;
  signupCompletedAt: string | null;
  /**
   * A signup link reached Meta and was accepted (wa_message_id is set). The id
   * itself stays server-side — the screen only needs the fact, and a provider
   * message id is not something to print on a lead's page.
   */
  linkSent: boolean;
  waDeliveryStatus: string | null;
  waDeliveryErrorCode: string | null;
  waStatusAt: string | null;
  hasAnalysis: boolean;
  callSuccessful: CallAnalysisSuccessful;
  callSuccessScore: number | null;
  status: CallAnalysisStatus;
  terminationReason: string | null;
  callDurationSecs: number | null;
  costCredits: number | null;
  agentTurns: number | null;
  userTurns: number | null;
  likelyVoicemail: boolean | null;
  evaluation: Record<string, string> | null;
  dataCollection: SalesCallDataCollection | null;
  analysisAt: string | null;
  agentId: string | null;
  /**
   * Persona-specific, null on every other source. Deliberately NOT flattened
   * into a shared vocabulary: 'confirmed' on a confirmation call and
   * 'completed' on a sales call answer different questions, and collapsing
   * them would lose exactly the fact the screen exists to show.
   */
  confirmationCallStatus: string | null;
  /** ElevenLabs' written account of the call — the one free-text field kept. */
  transcriptSummary: string | null;
  summaryTitle: string | null;
  sentimentLabel: string | null;
  frustrationScore: number | null;
};

export type CallbackRequestWithSalesSummary = CallbackRequest & {
  latestSalesCall: SalesCallCrmSummary | null;
};

export type CallbackRequestDetailWithSalesCalls = CallbackRequestDetail & {
  latestSalesCall: SalesCallCrmSummary | null;
  salesCalls: SalesCallCrmSummary[];
};

const CALLBACK_DETAIL_COLUMNS = `${CALLBACK_COLUMNS}, requested_at, calendar_item_id, attempt_count, scheduling_failure_reason, consecutive_no_answer_count`;

const SALES_CALL_ATTEMPT_COLUMNS = [
  'id',
  'callback_request_id',
  'dispatch_status',
  'scheduled_at_snapshot',
  'created_at',
  'updated_at',
  'vox_call_session_history_id',
  'finish_reason',
  'call_duration_sec',
  'el_conversation_id',
  'outcome_recorded_at',
  'signup_completed_at',
  'wa_message_id',
  'wa_delivery_status',
  'wa_delivery_error_code',
  'wa_status_at',
].join(', ');

const MEETING_CONFIRM_ATTEMPT_COLUMNS = [
  'id',
  'dispatch_status',
  'scheduled_at_snapshot',
  'created_at',
  'updated_at',
  'vox_call_session_history_id',
  'finish_reason',
  'call_duration_sec',
  'el_conversation_id',
  'confirmation_call_status',
].join(', ');

const CALL_ANALYSIS_COLUMNS = [
  'conversation_id',
  'agent_id',
  'call_successful',
  'status',
  'el_call_score',
  'termination_reason',
  'call_duration_secs',
  'cost_credits',
  'agent_turns',
  'user_turns',
  'el_eval',
  'el_data',
  'analysis_at',
  'transcript_summary',
  'summary_title',
  'voicemail_detected',
  'sentiment_label',
  'frustration_score',
].join(', ');

function callSuccessfulValue(value: string | null): CallAnalysisSuccessful {
  return value === 'success' || value === 'failure' || value === 'unknown' ? value : 'unknown';
}

function callAnalysisStatusValue(value: string | null): CallAnalysisStatus {
  return value === 'done' || value === 'failed' || value === 'unknown' ? value : 'unknown';
}

/**
 * Was this a voicemail?
 *
 * ElevenLabs' own detector answers it when it ran — `detected` is then a fact,
 * and the turn counts are not consulted at all. When it did NOT run (null), we
 * fall back to inferring it: an agent that talked while nobody answered back
 * looks like an answering machine. That inference is a guess, and it is wrong
 * in exactly the case that matters — a person who picks up and stays silent
 * produces the identical shape — so it is the fallback, never the answer.
 */
function likelyVoicemail(
  detected: boolean | null,
  agentTurns: number | null,
  userTurns: number | null,
): boolean | null {
  if (detected !== null) return detected;
  if (agentTurns === null || userTurns === null) return null;
  if (userTurns === 0 && agentTurns > 0) return true;
  if (userTurns > 0) return false;
  return null;
}

function jsonObject(value: Json | null): Record<string, Json> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function stringValue(value: Json | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: Json | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function salesDataCollection(value: Json | null): SalesCallDataCollection | null {
  const data = jsonObject(value);
  if (!data) return null;
  const out: SalesCallDataCollection = {
    callOutcome: stringValue(data.call_outcome),
    eventType: stringValue(data.event_type),
    estimatedGuestCount: numberValue(data.estimated_guest_count),
    whatsappConsent: booleanValue(data.whatsapp_consent),
    objectionReason: stringValue(data.objection_reason),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

function evaluationMap(value: Json | null): Record<string, string> | null {
  const data = jsonObject(value);
  if (!data) return null;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(data)) {
    if (typeof val === 'string') out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function mapAiCall(
  source: AiCallSource,
  callbackRequestId: string,
  attempt: AiCallAttemptSelect,
  analysis: CallAnalysisSelect | null,
): SalesCallCrmSummary {
  const agentTurns = analysis?.agent_turns ?? null;
  const userTurns = analysis?.user_turns ?? null;
  return {
    source,
    attemptId: attempt.id,
    callbackRequestId,
    // Present on both attempt tables, but the union type cannot know that, so
    // each falls back rather than being asserted.
    dispatchStatus: attempt.dispatch_status ?? 'start_unknown',
    attemptCreatedAt: attempt.created_at ?? new Date(0).toISOString(),
    attemptUpdatedAt: attempt.updated_at ?? attempt.created_at ?? new Date(0).toISOString(),
    scheduledAtSnapshot: attempt.scheduled_at_snapshot ?? null,
    finishReason: attempt.finish_reason ?? null,
    voxCallSessionHistoryId: attempt.vox_call_session_history_id ?? null,
    elConversationId: attempt.el_conversation_id ?? null,
    outcomeRecordedAt: attempt.outcome_recorded_at ?? null,
    signupCompletedAt: attempt.signup_completed_at ?? null,
    // Sales-only. A confirmation call sends no signup link, so this is false
    // there because it genuinely did not happen — not because we failed to look.
    linkSent: Boolean(attempt.wa_message_id),
    waDeliveryStatus: attempt.wa_delivery_status ?? null,
    waDeliveryErrorCode: attempt.wa_delivery_error_code ?? null,
    waStatusAt: attempt.wa_status_at ?? null,
    hasAnalysis: Boolean(analysis),
    callSuccessful: callSuccessfulValue(analysis?.call_successful ?? null),
    callSuccessScore: analysis?.el_call_score ?? null,
    status: callAnalysisStatusValue(analysis?.status ?? null),
    // Same fallback shape as callDurationSecs below, which this deliberately
    // mirrors: ElevenLabs' own reason when the analysis has landed, otherwise
    // the telephony's finish_reason, which Voximplant writes the moment the
    // call ends. There is always a window between the two — a minute on the
    // first real sales call, unbounded when a post-call webhook fails — and
    // for the whole of it the row already knows how the call ended. Falling
    // back to null instead printed "—" over data we had.
    terminationReason: analysis?.termination_reason ?? attempt.finish_reason ?? null,
    callDurationSecs: analysis?.call_duration_secs ?? attempt.call_duration_sec ?? null,
    costCredits: analysis?.cost_credits ?? null,
    agentTurns,
    userTurns,
    likelyVoicemail: likelyVoicemail(analysis?.voicemail_detected ?? null, agentTurns, userTurns),
    evaluation: evaluationMap(analysis?.el_eval ?? null),
    dataCollection: salesDataCollection(analysis?.el_data ?? null),
    transcriptSummary: analysis?.transcript_summary ?? null,
    summaryTitle: analysis?.summary_title ?? null,
    sentimentLabel: analysis?.sentiment_label ?? null,
    frustrationScore: analysis?.frustration_score ?? null,
    confirmationCallStatus: attempt.confirmation_call_status ?? null,
    analysisAt: analysis?.analysis_at ?? null,
    agentId: analysis?.agent_id ?? null,
  };
}

// One request's AI calls, every persona, in ONE round trip.
//
// The embed is PostgREST's own: `sales_call_attempts(...)` and
// `callback_request_attempts(...)` traverse the foreign keys those tables
// already have to callback_requests, and `call_analysis(...)` inside each of
// them traverses a COMPUTED RELATIONSHIP (migration
// 20260901091909_call_analysis_computed_relationships) — two `stable sql`
// functions that expose the existing text el_conversation_id link as an
// embeddable resource.
//
// Why a computed relationship and not a foreign key: the attempt row is
// written when the call ENDS, and its analysis arrives later on a webhook
// (seconds, or never — nine were lost to a bad secret this week). A FK from
// attempt to analysis would reject that write outright. It is impossible for a
// second reason too: the el_conversation_id unique indexes are PARTIAL, and
// Postgres cannot reference a partial unique index.
//
// Adding a fourth persona is one more small function plus its table name in
// the select below. No column, no view, no backfill.
const AI_CALL_ANALYSIS_EMBED = `call_analysis ( ${CALL_ANALYSIS_COLUMNS} )`;

const AI_CALL_EMBED = [
  'id',
  `sales_call_attempts ( ${SALES_CALL_ATTEMPT_COLUMNS}, ${AI_CALL_ANALYSIS_EMBED} )`,
  `callback_request_attempts ( ${MEETING_CONFIRM_ATTEMPT_COLUMNS}, ${AI_CALL_ANALYSIS_EMBED} )`,
].join(', ');

// PostgREST returns a computed relationship declared `rows 1` as a single
// object, not an array — but an unexpected shape must never crash the page, so
// both are accepted and anything else becomes "no analysis yet".
function embeddedAnalysis(value: unknown): CallAnalysisSelect | null {
  const row = Array.isArray(value) ? value[0] : value;
  return isCallAnalysisRow(row) ? row : null;
}

function isCallAnalysisRow(value: unknown): value is CallAnalysisSelect {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'conversation_id' in value &&
      typeof (value as { conversation_id?: unknown }).conversation_id === 'string',
  );
}

function isAttemptRow(value: unknown): value is AiCallAttemptSelect {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof (value as { id?: unknown }).id === 'string',
  );
}

function embeddedAttempts(value: unknown): AiCallAttemptSelect[] {
  return Array.isArray(value) ? value.filter(isAttemptRow) : [];
}

async function loadAiCallsForCallbacks(
  supabase: ReturnType<typeof createAdminClient>,
  callbackRequestIds: string[],
): Promise<Map<string, SalesCallCrmSummary[]>> {
  const ids = [...new Set(callbackRequestIds)].filter(Boolean);
  const byCallback = new Map<string, SalesCallCrmSummary[]>();
  if (ids.length === 0) return byCallback;

  const { data, error } = await supabase
    .from('callback_requests')
    .select(AI_CALL_EMBED)
    .in('id', ids);

  if (error) throw new Error('טעינת שיחות ה-AI נכשלה');

  for (const rawRow of Array.isArray(data) ? (data as unknown[]) : []) {
    if (!rawRow || typeof rawRow !== 'object') continue;
    const row = rawRow as Record<string, unknown>;
    const callbackId = typeof row.id === 'string' ? row.id : null;
    if (!callbackId) continue;

    const calls: SalesCallCrmSummary[] = [
      ...embeddedAttempts(row.sales_call_attempts).map((a) =>
        mapAiCall('sales', callbackId, a, embeddedAnalysis(a.call_analysis)),
      ),
      ...embeddedAttempts(row.callback_request_attempts).map((a) =>
        mapAiCall('meeting_confirm', callbackId, a, embeddedAnalysis(a.call_analysis)),
      ),
    ];

    // Newest first, across BOTH personas — the previous per-table ordering
    // could not interleave them, and interleaving is the whole point.
    calls.sort((a, b) => Date.parse(b.attemptCreatedAt) - Date.parse(a.attemptCreatedAt));
    byCallback.set(callbackId, calls);
  }

  return byCallback;
}

/**
 * One callback request, or null when the id does not exist.
 *
 * Returns null rather than throwing on a missing row so the page can render a
 * proper not-found instead of a server error — this URL is embedded in calendar
 * items that outlive the request they point at.
 */
export async function getCallbackRequest(
  id: string,
): Promise<CallbackRequestDetailWithSalesCalls | null> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('callback_requests')
    .select(CALLBACK_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error('טעינת בקשת החזרה נכשלה');
  if (!data) return null;

  const salesByCallback = await loadAiCallsForCallbacks(supabase, [data.id]);
  const salesCalls = salesByCallback.get(data.id) ?? [];
  return { ...data, latestSalesCall: salesCalls[0] ?? null, salesCalls };
}

/**
 * The callback request one calendar appointment was created for, or null.
 *
 * Keyed on the calendar item rather than on the request id, because the caller
 * holds an appointment and nothing else: /admin/calendar knows which item the
 * owner clicked. The partial unique index on `calendar_item_id` makes this at
 * most one row, so `maybeSingle` is exact rather than a "first of many".
 *
 * Null is the ordinary answer, not an error — most appointments in the mailbox
 * are the owner's own meetings and were never scheduled by this system.
 */
export async function getCallbackRequestByCalendarItem(
  calendarItemId: string,
): Promise<CallbackRequestDetailWithSalesCalls | null> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('callback_requests')
    .select(CALLBACK_DETAIL_COLUMNS)
    .eq('calendar_item_id', calendarItemId)
    .maybeSingle();

  if (error) throw new Error('טעינת בקשת החזרה נכשלה');
  if (!data) return null;

  const salesByCallback = await loadAiCallsForCallbacks(supabase, [data.id]);
  const salesCalls = salesByCallback.get(data.id) ?? [];
  return { ...data, latestSalesCall: salesCalls[0] ?? null, salesCalls };
}

// List callback requests, newest first, with exact total for pagination.
export async function listCallbackRequests(
  { page }: PageParams = {},
): Promise<PageResult<CallbackRequestWithSalesSummary>> {
  await requirePlatformPermission('view_customer_data');

  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const supabase = createAdminClient();
  const { data, error, count } = await supabase
    .from('callback_requests')
    .select(CALLBACK_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error('טעינת בקשות החזרה נכשלה');
  }

  const rows = data ?? [];
  const salesByCallback = await loadAiCallsForCallbacks(
    supabase,
    rows.map((r) => r.id),
  );

  return {
    items: rows.map((r) => ({
      ...r,
      latestSalesCall: salesByCallback.get(r.id)?.[0] ?? null,
    })),
    total: count ?? 0,
    page: safePage,
    pageSize,
  };
}

// Cancel a request outright — the ONE scheduling-status transition an admin
// makes directly (every other `status` value is system-driven; see
// validation/admin.ts). The `updated_at` column is maintained by a DB
// trigger; we don't set it explicitly here, unlike the pre-redesign version
// of this function — cb_set_updated_at (migration
// 20260819212112_callback_status_outcome_split.sql) handles it on every
// UPDATE now, so a second explicit write would just be redundant.
export type CancelCallbackResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'already_cancelled' | 'already_closed' };

export async function cancelCallback(id: string): Promise<CancelCallbackResult> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('callback_requests')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('ביטול הבקשה נכשל');
  }

  // A terminal request is REFUSED here, on the server — the hidden button in
  // CancelCallbackForm is the visible consequence of this rule, never the rule
  // itself (hidden UI is not authorization). Cancelling a 'closed' request
  // would rewrite a call that actually happened as one that was called off;
  // see CALLBACK_TERMINAL_STATUSES for the full reasoning.
  if (!current) return { ok: false, reason: 'not_found' };
  if (!isCancellableCallbackStatus(current.status)) {
    return {
      ok: false,
      reason: current.status === 'cancelled' ? 'already_cancelled' : 'already_closed',
    };
  }

  // The status filter is repeated in the UPDATE itself, so the read above is
  // not load-bearing: between it and this write, applyCallOutcome could have
  // closed the request from a post-call webhook. The read decides WHICH
  // refusal to report; this filter is what actually guarantees the row is
  // never overwritten.
  const { error, count } = await supabase
    .from('callback_requests')
    .update({ status: 'cancelled' }, { count: 'exact' })
    .eq('id', id)
    // Deny-list, matching isCancellableCallbackStatus exactly: `status` is free
    // text, so an allow-list would leave an unknown/legacy value permanently
    // uncancellable while the read above says it is fine.
    .not('status', 'in', `(${CALLBACK_TERMINAL_STATUSES.join(',')})`);

  if (error) {
    throw new Error('ביטול הבקשה נכשל');
  }
  // Lost that race: the request went terminal after the read. Report it as
  // what it now is, and do NOT archive the appointment or log a cancellation
  // that never happened.
  if (count === 0) return { ok: false, reason: 'already_closed' };

  // A cancelled request needs no future call — its calendar appointment is
  // archived (never deleted; see closeCallbackAppointment) so there's still a
  // record it existed and was cancelled, not just silence. Best-effort and
  // never blocks the cancellation itself.
  const calendarAppointmentArchived = (
    await closeCallbackAppointment(id, { reason: 'cancelled' })
  ).archived;

  await logActivity({
    action: 'callback.cancelled',
    meta: {
      callbackRequestId: id,
      previousStatus: current.status,
      calendarAppointmentArchived,
    },
  });

  return { ok: true };
}

// Records what happened when the owner actually made the call — independent
// of `status` (the scheduler's own state; see cancelCallback above and
// validation/admin.ts). Delegates the actual state machine (archive the
// appointment, decide whether the REQUEST closes or re-enters scheduling,
// the three-strikes no-contact auto-close + SMS) to applyCallOutcome — same
// gate-wraps-logic split as rescheduleCallback below wrapping
// rescheduleCallbackRequest.
export async function updateCallOutcome(
  id: string,
  callOutcome: CallOutcome,
): Promise<void> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('callback_requests')
    .select('call_outcome')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('עדכון תוצאת השיחה נכשל');
  }

  const result = await applyCallOutcome(id, callOutcome);

  await logActivity({
    action: 'callback.outcome_updated',
    meta: {
      callbackRequestId: id,
      previousOutcome: current?.call_outcome ?? null,
      callOutcome,
      calendarAppointmentArchived: result.archived,
      requestClosed: result.requestClosed,
    },
  });
}

/**
 * Admin-gated wrapper around rescheduleCallbackRequest — mirrors how
 * cancelCallback above gates its own write and then calls the request-free
 * closeCallbackAppointment. rescheduleCallbackRequest lives in
 * callback-scheduling.ts REQUEST-FREE (no requireUser/cookies, so the worker
 * bundle can import that module), so it carries no authorization of its own;
 * this is the only path a browser request can reach it through.
 */
export async function rescheduleCallback(
  id: string,
  exactIso: string,
): Promise<RescheduleOutcome> {
  await requirePlatformPermission('view_customer_data');

  const outcome = await rescheduleCallbackRequest(id, exactIso);

  await logActivity({
    action: 'callback.rescheduled',
    meta: { callbackRequestId: id, ok: outcome.ok, ...(outcome.ok ? {} : { reason: outcome.reason }) },
  });

  return outcome;
}
