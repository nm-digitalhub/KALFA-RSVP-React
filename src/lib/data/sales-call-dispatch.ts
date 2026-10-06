import 'server-only';

import { randomBytes } from 'node:crypto';

import type { PgBoss } from 'pg-boss';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { normalizePhone } from '@/lib/phone';
import { QUEUES, CALL_RETRY } from '@/lib/queue/queues';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import {
  evaluateSharedConsentGates,
  DIAL_GATE_POLICY,
  type DialTargetFailureReason,
} from '@/lib/data/console-calls';
import { getCallbackPolicy } from '@/lib/callbacks/policy-config';
import {
  createSalesDispatchAttempt,
  getSalesDispatchAttemptBySlot,
  getUnresolvedSalesAttempt,
  recordSalesDialConfirmed,
  markSalesDispatchFailed,
  markSalesDispatchUnknown,
  recordSalesDialAudit,
  countRecentSalesAuditedAttempts,
  DISPATCH_PRE_TERMINAL,
} from '@/lib/data/sales-call-attempts';
import { countActiveCallsAllSurfaces } from '@/lib/data/voximplant-concurrency';
import {
  getAccountInfo,
  VoximplantApiError,
  VoximplantNetworkError,
  type VoximplantConfig,
} from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';

// The outbound dispatcher for the sales-closing agent's call on a
// callback_requests row (topic = 'מכירות'; sales-closing plan §5.2) —
// NOT dispatchOutreachCall, structurally incompatible with a row that has no
// campaign/event/guest (confirmed independently by both this repo's plans and
// by reading dispatchOutreachCall in full). Same proven pattern as
// meeting-confirm-dispatch.ts and dispatchOutreachCall: fresh gates at
// dispatch time, atomic idempotent create, balance precheck with a timeout,
// StartScenarios with a timeout and definite/ambiguous classification.
//
// SCOPE BOUNDARY, deliberate: this file is DISPATCH-INITIATION mechanics
// only — whether StartScenarios itself succeeded (dialed / failed_to_start /
// start_unknown). It NEVER calls applyCallOutcome and NEVER WRITES
// callback_requests.call_outcome or sales_call_attempts.outcome_recorded_at.
// It reads outcome_recorded_at once, read-only, purely to decide
// whether to dial again — see getUnresolvedSalesAttempt's own doc comment
// and gate 2b below.
//
// The full outcome-write picture is FOUR separate write paths sharing ONE
// outcome_recorded_at claim on sales_call_attempts, split by trust level (the
// same split RSVPAgent already establishes between its telephony-truth cb
// callback and its guest-asserted agent-tool routes):
//   1. no_answer  — owned by the SCENARIO'S TERMINAL CALLBACK route
//      (sls/cb; mirrors RSVPAgent's postFinalCallbackOnce/terminalStatus()),
//      the moment Voximplant reports the call never carried a real
//      conversation. NOT this file, and NOT this file's own
//      failed_to_start/start_unknown — see the note below on why those two
//      are a genuinely different, non-telephony failure class.
//   2. completed  — sls/tool/signup-link, written the moment send_signup_link's
//      WhatsApp or SMS-fallback send is synchronously accepted by the
//      provider (not a delivery/read confirmation).
//   3. needs_followup / closed (escalated_to_human is mapped to
//      needs_followup)  — sls/tool/log-outcome, a live ElevenLabs-tool-call
//      route, legitimately the agent's own judgment call, lowest blast radius.
//   4. needs_followup catch-all  — the ElevenLabs post-call analysis, for a
//      conversation that ended without the agent calling either tool above.
// All four must claim sales_call_attempts.outcome_recorded_at (UPDATE ...
// WHERE outcome_recorded_at IS NULL RETURNING id) in the SAME statement
// immediately before calling applyCallOutcome — and ONLY there. This
// dispatch-initiation function must NEVER claim it: it runs before any call
// happens, and a claim here with no applyCallOutcome behind it would burn
// the one-shot guard for the whole attempt before the real outcome (from
// path 1, 2, 3, or 4 above) ever arrives.
//
// failed_to_start/start_unknown (StartScenarios itself never placed the
// call — balance, config, provider rejection) deliberately do NOT resolve to
// callback_requests.call_outcome='no_answer'. Concrete harm if they did:
// applyCallOutcome('no_answer') increments consecutive_no_answer_count, and
// at 3 auto-closes the row (status='closed', call_outcome='no_contact') and
// sends the customer a "we tried three times and couldn't reach you" SMS —
// three balance/config failures could close a live lead and send that
// message having never actually dialed once. Dispatch-level failures (this
// file) are recorded on sales_call_attempts only and leave callback_requests
// untouched; only a REAL telephony no-connect, reported by the scenario's cb
// route, writes 'no_answer'.
//
// SCHEDULING HAZARD, closed here: rescheduleCallbackRequest()
// (callback-scheduling.ts, admin- or agent-tool-triggered, not a sweep) can move this SAME
// row from 'scheduled' to 'needs_reschedule' and back to 'scheduled' with a
// NEW scheduled_at at any time, including while an earlier call's outcome is
// still unresolved — producing a new sales_call_attempts_request_slot_uidx
// key the unique index cannot catch. Closed via gate 2b /
// getUnresolvedSalesAttempt, not via any change to callback-scheduling.ts:
// runCallbackSchedulingSweep itself never re-picks up a still-'scheduled'
// row (its candidate query requires calendar_item_id IS NULL and excludes
// status 'scheduled').

const SALES_TOKEN_TTL_SEC = 2 * 60 * 60; // 2h — see meeting-confirm-dispatch.ts's identical constant for why this value is only valid because mint and dial happen in the same tick.
const BALANCE_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 25_000;

export type SalesCallDispatchConfig = {
  auth: VoximplantConfig;
  ruleId: string;
  callerId: string;
  minCallReserve: number;
  lowBalanceThreshold: number;
  maxConcurrentCalls: number;
  // The AI-calling-specific kill switch for this persona, resolved by the
  // caller (getSalesCallDispatchConfig, from
  // app_settings.voximplant_sales_calls_enabled) — see
  // meeting-confirm-dispatch.ts's identical field for why this is a plain
  // parameter rather than read from app_settings here.
  callsEnabled: boolean;
};

export type SalesCallDispatchResult =
  | {
      kind: 'skipped';
      reason: 'not_scheduled' | 'attempt_cap' | 'prior_call_unresolved' | DialTargetFailureReason;
    }
  | { kind: 'blocked'; reason: 'calls_disabled' | 'balance_below_reserve' }
  | { kind: 'transient_error'; reason: 'balance_check_failed' } // the ONLY retryable kind
  | { kind: 'max_concurrency' }
  | { kind: 'concurrent_owner' }
  | { kind: 'already_dispatched'; attemptId: string }
  | { kind: 'already_concluded'; attemptId: string; dispatchStatus: string }
  | { kind: 'dialed'; attemptId: string; callSessionHistoryId: number }
  | { kind: 'failed_to_start'; attemptId: string; code: number | null }
  | { kind: 'start_unknown'; attemptId: string };

async function alert(
  level: 'warn' | 'error',
  title: string,
  fields: Record<string, string | number>,
): Promise<void> {
  await sendSlackAlert({ level, title, source: 'sales-call-dispatch', category: 'send_health', fields });
}

// Single source of truth for the scenario payload (Branch B, same shape as
// outreach-calls.ts's buildScriptCustomData and meeting-confirm-dispatch.ts's
// buildMeetingConfirmCustomData). No `ca`/`dh` DTMF-handoff keys — same
// reasoning as the meeting-confirm payload: no live-takeover mechanism wired
// for this token surface in v1.
export function buildSalesCallCustomData(args: {
  to: string;
  from: string;
  tok: string;
  u: string;
}): { payload: string; bytes: number } {
  const payload = JSON.stringify({ to: args.to, from: args.from, tok: args.tok, u: args.u });
  return { payload, bytes: Buffer.byteLength(payload, 'utf8') };
}

export type SalesCallDispatchJob = { callbackRequestId: string };

// Minimum lead time before the actual dial — protects against the
// scheduling sweep running late (or the row already being past due by the
// time this enqueue call runs) by never scheduling a job in the past.
// scheduled_at itself is ALREADY inside DEFAULT_CALLBACK_POLICY's window
// (findCallbackSlot placed it there) — unlike meeting-confirm's 24h-earlier
// target, there is no separate clampIntoCallbackWindow step here.
const SALES_DISPATCH_MIN_DELAY_MS = 60 * 1000;

// THE dispatch trigger for dispatchSalesCall below — without this,
// dispatchSalesCall is unreachable code. Mirrors
// enqueueMeetingConfirmDispatch's shape exactly but fires AT scheduled_at,
// not 24h before it (dispatchSalesCall's own comment: "exactly
// replacing what a human rep does today at that slot"). Call this from the
// SAME place enqueueMeetingConfirmDispatch is called (runCallbackSchedulingSweep,
// right after a slot is booked) — the two are mutually exclusive by topic,
// never both enqueued for the same row.
// Exported for the same reason as meeting-confirm-dispatch.ts's
// meetingConfirmDispatchJobId — the calendar-move reconciler in
// callback-scheduling.ts needs to cancel a previously-enqueued job by its
// exact id, derived once here rather than duplicated by hand.
export function salesCallDispatchJobId(requestId: string, scheduledMs: number): string {
  return deterministicJobId(`sales-call-dispatch:${requestId}:${scheduledMs}`);
}

export async function enqueueSalesCallDispatch(
  boss: PgBoss,
  request: { id: string; topic: string | null; scheduledAtIso: string },
  nowMs: number = Date.now(),
): Promise<void> {
  if (request.topic !== 'מכירות') return;
  const scheduledMs = Date.parse(request.scheduledAtIso);
  if (Number.isNaN(scheduledMs)) return;
  const targetMs = Math.max(scheduledMs, nowMs + SALES_DISPATCH_MIN_DELAY_MS);
  // Deterministic id keyed to (request, scheduled_at) — a duplicate enqueue
  // for the SAME slot (e.g. the sweep re-running) is a silent no-op, same
  // idiom as enqueueMeetingConfirmDispatch / enqueueStepJob. pgboss.job.id
  // is a strict uuid column (verified live: information_schema + pg-boss's
  // own DDL in node_modules/pg-boss/dist/plans.js — "id uuid NOT NULL
  // DEFAULT gen_random_uuid()") — hash the composite key through
  // deterministicJobId, never pass it raw (throws 22P02 at insert time).
  const id = salesCallDispatchJobId(request.id, scheduledMs);
  const job: SalesCallDispatchJob = { callbackRequestId: request.id };
  await boss.send(QUEUES.salesCallDispatch, job, { id, startAfter: new Date(targetMs), ...CALL_RETRY });
}

export async function dispatchSalesCall(
  callbackRequestId: string,
  config: SalesCallDispatchConfig,
  appOrigin: string,
): Promise<SalesCallDispatchResult> {
  // 1. The AI-calling kill switch for this channel specifically.
  if (!config.callsEnabled) return { kind: 'blocked', reason: 'calls_disabled' };

  // 2. Fresh row read — never trust a stale snapshot. This call fires AT
  //    callback_requests.scheduled_at (team-lead, 2026-08-22: "exactly
  //    replacing what a human rep does today at that slot"), so a row can
  //    leave 'scheduled' between whenever it was enqueued and this tick the
  //    same way a meeting-confirm row can.
  const admin = createAdminClient();
  const { data: row, error: rowErr } = await admin
    .from('callback_requests')
    .select('id, phone, status, scheduled_at')
    .eq('id', callbackRequestId)
    .maybeSingle();
  if (rowErr) throw new Error('טעינת בקשת שיחה חוזרת נכשלה');
  if (!row || row.status !== 'scheduled' || !row.scheduled_at) {
    return { kind: 'skipped', reason: 'not_scheduled' };
  }
  const phone = normalizePhone(row.phone);
  if (!phone) return { kind: 'skipped', reason: 'invalid_phone' };
  const scheduledAtSnapshot = row.scheduled_at;

  // 2b. Cross-slot guard — see getUnresolvedSalesAttempt's own doc comment.
  //     Closes the reschedule-mid-confirmation gap: sales_call_attempts_
  //     request_slot_uidx only guards a same-slot retry, and does nothing
  //     once rescheduleCallbackRequest() gives this row a NEW scheduled_at
  //     while an earlier call's async outcome is still unresolved.
  const unresolved = await getUnresolvedSalesAttempt(callbackRequestId);
  if (unresolved) return { kind: 'skipped', reason: 'prior_call_unresolved' };

  // 3. Same admin-editable attempt cap shared with human dials and the
  //    meeting-confirm dispatcher — checked before any provider call.
  const policy = await getCallbackPolicy();
  const attempts = await countRecentSalesAuditedAttempts(callbackRequestId, Date.now(), policy);
  if (attempts >= policy.maxAttempts) return { kind: 'skipped', reason: 'attempt_cap' };

  // 4. Consent/hours — DIAL_GATE_POLICY.callback verbatim, same reasoning as
  //    meeting-confirm-dispatch.ts: this is a returned callback, findCallbackSlot
  //    already placed scheduled_at inside DEFAULT_CALLBACK_POLICY's tighter
  //    window, so no hoursGate override or allowOutsideHours is used.
  const shared = await evaluateSharedConsentGates(admin, phone, Date.now(), {
    policy: DIAL_GATE_POLICY.callback,
  });
  if (!shared.ok) return { kind: 'skipped', reason: shared.reason };

  // 5. Concurrency cap — the COMBINED cross-table count across ALL THREE
  //    Voximplant dispatch surfaces (voximplant-concurrency.ts).
  const active = await countActiveCallsAllSurfaces();
  if (active >= config.maxConcurrentCalls) {
    await alert('warn', 'Voximplant max concurrency reached — deferring sales-closing call', {
      callbackRequestId, active, cap: config.maxConcurrentCalls,
    });
    return { kind: 'max_concurrency' };
  }

  // 6. Balance precheck BEFORE any attempt row is created (so no orphaned row).
  let balance: number;
  try {
    const info = await getAccountInfo(config.auth, BALANCE_TIMEOUT_MS);
    balance = info.result.balance;
  } catch {
    return { kind: 'transient_error', reason: 'balance_check_failed' };
  }
  if (balance < config.minCallReserve) {
    await alert('error', 'Voximplant balance below reserve — sales-closing call blocked', {
      callbackRequestId, balance, minReserve: config.minCallReserve,
    });
    return { kind: 'blocked', reason: 'balance_below_reserve' };
  }
  if (balance < config.lowBalanceThreshold) {
    await alert('warn', 'Voximplant balance low', { callbackRequestId, balance, lowThreshold: config.lowBalanceThreshold });
    // proceed — warn only.
  }

  // 7. ATOMIC create — sales_call_attempts_request_slot_uidx is a PLAIN
  //    (non-partial) unique index, so upsert()+ignoreDuplicates is the
  //    correct primitive here (unlike callback-request-attempts.ts's
  //    partial-index workaround) — see createSalesDispatchAttempt's own doc
  //    comment.
  const accessToken = randomBytes(16).toString('hex');
  const tokenExpiresAt = new Date(Date.now() + SALES_TOKEN_TTL_SEC * 1000).toISOString();
  const created = await createSalesDispatchAttempt({
    callbackRequestId,
    accessToken,
    tokenExpiresAt,
    scheduledAtSnapshot,
  });

  if (created === null) {
    // Lost the race — reconcile, never redial.
    const existing = await getSalesDispatchAttemptBySlot(callbackRequestId, scheduledAtSnapshot);
    if (!existing) return { kind: 'concurrent_owner' }; // fail-closed
    if (existing.vox_call_session_history_id) {
      return { kind: 'already_dispatched', attemptId: existing.id };
    }
    if ((DISPATCH_PRE_TERMINAL as readonly string[]).includes(existing.dispatch_status)) {
      return { kind: 'concurrent_owner' };
    }
    return { kind: 'already_concluded', attemptId: existing.id, dispatchStatus: existing.dispatch_status };
  }
  const attemptId = created.id;

  // 8. Audit — same shared CONSOLE_DIAL_AUDIT_ACTION write as every other
  //    caller of this callback_request_id's dial budget.
  await recordSalesDialAudit(callbackRequestId);

  // 9. Assemble the payload — log ONLY the byte count.
  const { payload, bytes } = buildSalesCallCustomData({
    to: phone,
    from: config.callerId,
    tok: accessToken,
    u: appOrigin,
  });
  console.log('[sales-call-dispatch] dispatching', { callbackRequestId, attemptId, payloadBytes: bytes });

  // 10. StartScenarios — definite vs ambiguous classification, identical
  //     discipline to dispatchOutreachCall / meeting-confirm-dispatch.ts.
  try {
    const res = await startScenarios(config.auth, { rule_id: config.ruleId, script_custom_data: payload }, START_TIMEOUT_MS);
    if (res.result === 1 && res.call_session_history_id != null) {
      await recordSalesDialConfirmed(attemptId, res.call_session_history_id);
      return { kind: 'dialed', attemptId, callSessionHistoryId: res.call_session_history_id };
    }
    await markSalesDispatchUnknown(attemptId, 'ambiguous_start_response');
    return { kind: 'start_unknown', attemptId };
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      await markSalesDispatchFailed(attemptId, e.message);
      await alert('warn', 'Voximplant StartScenarios rejected sales-closing call (failed_to_start)', {
        callbackRequestId, attemptId, code: e.code ?? 0,
      });
      return { kind: 'failed_to_start', attemptId, code: e.code };
    }
    if (e instanceof VoximplantNetworkError) {
      await markSalesDispatchUnknown(attemptId, 'network_error_during_start');
      await alert('warn', 'Voximplant StartScenarios ambiguous for sales-closing call (start_unknown)', {
        callbackRequestId, attemptId,
      });
      return { kind: 'start_unknown', attemptId };
    }
    throw e; // truly unexpected — let the caller's own catch alert + rethrow
  }
}
