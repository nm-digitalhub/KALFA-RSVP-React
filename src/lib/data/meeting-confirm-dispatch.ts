import 'server-only';

import { randomBytes } from 'node:crypto';

import type { PgBoss } from 'pg-boss';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { normalizePhone } from '@/lib/phone';
import { QUEUES, CALL_RETRY } from '@/lib/queue/queues';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { clampIntoCallbackWindow } from '@/lib/callbacks/schedule-policy';
import {
  evaluateSharedConsentGates,
  DIAL_GATE_POLICY,
  CALLBACK_MAX_ATTEMPTS,
  type DialTargetFailureReason,
} from '@/lib/data/console-calls';
import {
  createCallbackDispatchAttempt,
  getCallbackDispatchAttemptBySlot,
  recordCallbackDialConfirmed,
  markCallbackDispatchFailed,
  markCallbackDispatchUnknown,
  recordCallbackDialAudit,
  countRecentCallbackAuditedAttempts,
  DISPATCH_PRE_TERMINAL,
} from '@/lib/data/callback-request-attempts';
import { countActiveCallsAllSurfaces } from '@/lib/data/voximplant-concurrency';
import {
  getAccountInfo,
  VoximplantApiError,
  VoximplantNetworkError,
  type VoximplantConfig,
} from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';

// The outbound confirmation-call dispatcher for callback_requests rows
// (meeting-booking plan, SS2/SS11a) — NOT dispatchOutreachCall, which is
// structurally campaign/event/guest-shaped and cannot represent a row with
// neither (confirmed by reading it in full; see the meeting-booking and
// sales-closing plans' own §11/§5.1 for the same finding independently).
// Follows the SAME proven pattern instead: balance precheck with an explicit
// timeout, atomic idempotent create, StartScenarios with an explicit timeout
// and definite/ambiguous result classification, and every gate checked FRESH
// at dispatch time rather than trusted from whenever the row was queued.
//
// This is a 30-45s confirmation/reschedule ping (meeting-booking plan §3), not
// the substantive call the row's topic is actually about — the scenario it
// dials is deliberately minimal (no monitor/takeover conference wiring, no
// DTMF handoff) and is NOT written yet: it depends on the mtg/ctx + mtg/cb
// route handlers, which are a separate, security-reviewed (public-rsvp-
// sentinel) piece of work this dispatcher does not build or assume exists.

const CONFIRM_TOKEN_TTL_SEC = 2 * 60 * 60; // 2h, matching outreach-calls.ts's CALL_TOKEN_TTL_SEC.
// Valid ONLY because this function mints the token and calls StartScenarios
// in the same tick (createCallbackDispatchAttempt immediately precedes the
// dial below) — if a future batching/queueing layer ever mints tokens ahead
// of the actual dial, this value must be revisited; it is not a general
// "how long is a confirmation call worth" constant.
const BALANCE_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 25_000;

export type MeetingConfirmDispatchConfig = {
  auth: VoximplantConfig;
  ruleId: string;
  callerId: string;
  minCallReserve: number;
  lowBalanceThreshold: number;
  maxConcurrentCalls: number;
  // The AI-calling-specific kill switch, resolved by the caller. Deliberately
  // NOT read from getOutreachEnabled()/app_settings here — that flag gates
  // the RSVP campaign dispatcher, and the owner must be able to stop this
  // channel independently of RSVP outreach. The concrete app_settings column
  // this resolves from does not exist yet (flagged separately, not this
  // file's concern) — taking it as a plain boolean parameter lets this
  // function be written and unit-tested now, and wired to a real config
  // resolver the moment that column lands.
  callsEnabled: boolean;
};

export type MeetingConfirmDispatchResult =
  | { kind: 'skipped'; reason: 'not_scheduled' | 'attempt_cap' | 'already_past' | DialTargetFailureReason }
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
  await sendSlackAlert({ level, title, source: 'meeting-confirm-dispatch', category: 'send_health', fields });
}

// Single source of truth for the scenario payload (Branch B, same shape as
// outreach-calls.ts's buildScriptCustomData). Deliberately narrower: no `ca`/
// `dh` DTMF-handoff keys — this persona has no live-takeover mechanism in v1
// (both plans put escalation at console_queues for MVP, not a conference
// bridge), so a scenario built against this payload should never expect them.
export function buildMeetingConfirmCustomData(args: {
  to: string;
  from: string;
  tok: string;
  u: string;
}): { payload: string; bytes: number } {
  const payload = JSON.stringify({ to: args.to, from: args.from, tok: args.tok, u: args.u });
  return { payload, bytes: Buffer.byteLength(payload, 'utf8') };
}

export type MeetingConfirmDispatchJob = { callbackRequestId: string };

const MEETING_CONFIRM_LEAD_MS = 24 * 60 * 60 * 1000; // plan §2: "~24 שעות לפני scheduled_at"
// Never fire sooner than this from the moment of booking — a meeting booked
// for later today still gets a reminder, just as soon as legally possible,
// rather than a target instant already in the past.
const MEETING_CONFIRM_MIN_DELAY_MS = 5 * 60 * 1000;

// Event-driven dispatch TRIGGER, called once by runCallbackSchedulingSweep
// right after a slot is actually booked — NOT a periodic scan. Durable (a
// pg-boss job persists in Postgres, so it survives a worker restart) and
// self-correcting for reschedules with no cancellation logic needed: see the
// QUEUES.meetingConfirmDispatch comment for why a stale job left over from a
// since-superseded booking is harmless when it eventually fires — it re-reads
// fresh state and the atomic per-(request, scheduled_at) attempt uniqueness
// (createCallbackDispatchAttempt) means at most one job for a row can ever
// actually place a call.
//
// Deliberately excludes topic='מכירות' (B1, meeting-booking plan §11):
// callback_requests rows opened for a sales conversation are the
// sales-closing agent's own future dispatch surface, not this one — dialling
// both personas for the same row would double-call the lead.
export async function enqueueMeetingConfirmDispatch(
  boss: PgBoss,
  request: { id: string; topic: string | null; scheduledAtIso: string },
  nowMs: number = Date.now(),
): Promise<void> {
  if (request.topic === 'מכירות') return;

  const scheduledMs = Date.parse(request.scheduledAtIso);
  if (Number.isNaN(scheduledMs)) return;

  const rawTargetMs = scheduledMs - MEETING_CONFIRM_LEAD_MS;
  const clampedMs = clampIntoCallbackWindow(
    Math.max(rawTargetMs, nowMs + MEETING_CONFIRM_MIN_DELAY_MS),
  );

  // Deterministic id keyed on (request, scheduled instant): a reschedule
  // books a NEW instant and therefore gets its OWN job — the prior job for
  // the earlier instant is left in place rather than cancelled (this
  // codebase has no cancel-by-id precedent to reuse), safe to fire late per
  // the module comment above. pgboss.job.id is a strict uuid column — hash
  // the composite key through deterministicJobId rather than passing it raw
  // (a raw composite string throws 22P02 at insert time; found live
  // 2026-08-22 via the worker's own error log — this call had been silently
  // failing on every single invocation since it was built).
  const id = deterministicJobId(`meeting-confirm:${request.id}:${scheduledMs}`);
  const job: MeetingConfirmDispatchJob = { callbackRequestId: request.id };
  await boss.send(QUEUES.meetingConfirmDispatch, job, {
    id,
    startAfter: new Date(clampedMs),
    ...CALL_RETRY,
  });
}

export async function dispatchMeetingConfirmCall(
  callbackRequestId: string,
  config: MeetingConfirmDispatchConfig,
  appOrigin: string,
): Promise<MeetingConfirmDispatchResult> {
  // 1. The AI-calling kill switch for this channel specifically.
  if (!config.callsEnabled) return { kind: 'blocked', reason: 'calls_disabled' };

  // 2. Fresh row read — never trust a stale snapshot from whenever this was
  //    enqueued. A row can leave 'scheduled' between enqueue and this tick
  //    (reconcileCallbacksWithCalendar releasing it, an admin cancelling it,
  //    applyCallOutcome closing it from an unrelated path).
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

  // A row can reach here with a scheduled_at already in the past — the worker
  // was down long enough that a delayed dispatch job fired late, or a stale
  // job survived a reschedule (see enqueueMeetingConfirmDispatch's own
  // comment: a superseded job is expected to fire and no-op, not to have been
  // cancelled). A "still confirms it's on?" call about a meeting that already
  // happened is useless at best; never place it.
  if (Date.parse(scheduledAtSnapshot) <= Date.now()) {
    return { kind: 'skipped', reason: 'already_past' };
  }

  // 3. The same 3-attempt cap that already protects this row against
  //    repeated human console dials — checked BEFORE any provider call, same
  //    ordering discipline as every other gate here.
  const attempts = await countRecentCallbackAuditedAttempts(callbackRequestId, Date.now());
  if (attempts >= CALLBACK_MAX_ATTEMPTS) return { kind: 'skipped', reason: 'attempt_cap' };

  // 4. Consent/hours — DIAL_GATE_POLICY.callback verbatim (the exact policy
  //    row resolveDialTarget's own callback branch uses), no hoursGate
  //    override and no allowOutsideHours: this fires at scheduled_at, which
  //    findCallbackSlot already placed inside DEFAULT_CALLBACK_POLICY's
  //    tighter window by construction, so the general daily window is
  //    satisfied as a matter of course, never by an explicit bypass.
  const shared = await evaluateSharedConsentGates(admin, phone, Date.now(), {
    policy: DIAL_GATE_POLICY.callback,
  });
  if (!shared.ok) return { kind: 'skipped', reason: shared.reason };

  // 5. Concurrency cap — the COMBINED cross-table count (voximplant-
  //    concurrency.ts), never call_attempts or callback_request_attempts
  //    counted alone: both tables share one Voximplant account/balance.
  const active = await countActiveCallsAllSurfaces();
  if (active >= config.maxConcurrentCalls) {
    await alert('warn', 'Voximplant max concurrency reached — deferring meeting-confirm call', {
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
    await alert('error', 'Voximplant balance below reserve — meeting-confirm call blocked', {
      callbackRequestId, balance, minReserve: config.minCallReserve,
    });
    return { kind: 'blocked', reason: 'balance_below_reserve' };
  }
  if (balance < config.lowBalanceThreshold) {
    await alert('warn', 'Voximplant balance low', { callbackRequestId, balance, lowThreshold: config.lowBalanceThreshold });
    // proceed — warn only.
  }

  // 7. ATOMIC create — see createCallbackDispatchAttempt's own doc comment for
  //    why this is a plain insert + 23505 catch, not upsert().
  const accessToken = randomBytes(16).toString('hex');
  const tokenExpiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_SEC * 1000).toISOString();
  const created = await createCallbackDispatchAttempt({
    callbackRequestId,
    accessToken,
    tokenExpiresAt,
    scheduledAtSnapshot,
  });

  if (created === null) {
    // Lost the race — reconcile, never redial (dispatchOutreachCall's own
    // reconcile discipline, applied identically here).
    const existing = await getCallbackDispatchAttemptBySlot(callbackRequestId, scheduledAtSnapshot);
    if (!existing) return { kind: 'concurrent_owner' }; // fail-closed
    if (existing.vox_call_session_history_id) {
      return { kind: 'already_dispatched', attemptId: existing.id };
    }
    if ((DISPATCH_PRE_TERMINAL as readonly string[]).includes(existing.dispatch_status)) {
      // The winner is presumably still in-flight. Do NOT touch the row, do
      // NOT dial. A genuinely stuck row is a separate, not-yet-built,
      // time-based reconciler's job — never this function's.
      return { kind: 'concurrent_owner' };
    }
    return { kind: 'already_concluded', attemptId: existing.id, dispatchStatus: existing.dispatch_status };
  }
  const attemptId = created.id;

  // 8. Audit — write the SAME action a human console dial writes, so an
  //    AI-dispatched call is visible to whatever already reads it for this
  //    callback_request_id, including the cap checked in step 3.
  await recordCallbackDialAudit(callbackRequestId);

  // 9. Assemble the payload (single source of truth) — log ONLY the byte count.
  const { payload, bytes } = buildMeetingConfirmCustomData({
    to: phone,
    from: config.callerId,
    tok: accessToken,
    u: appOrigin,
  });
  console.log('[meeting-confirm-dispatch] dispatching', { callbackRequestId, attemptId, payloadBytes: bytes });

  // 10. StartScenarios — definite vs ambiguous classification, identical
  //     discipline to dispatchOutreachCall.
  try {
    const res = await startScenarios(config.auth, { rule_id: config.ruleId, script_custom_data: payload }, START_TIMEOUT_MS);
    if (res.result === 1 && res.call_session_history_id != null) {
      await recordCallbackDialConfirmed(attemptId, res.call_session_history_id);
      return { kind: 'dialed', attemptId, callSessionHistoryId: res.call_session_history_id };
    }
    await markCallbackDispatchUnknown(attemptId, 'ambiguous_start_response');
    return { kind: 'start_unknown', attemptId };
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      await markCallbackDispatchFailed(attemptId, e.message);
      await alert('warn', 'Voximplant StartScenarios rejected meeting-confirm call (failed_to_start)', {
        callbackRequestId, attemptId, code: e.code ?? 0,
      });
      return { kind: 'failed_to_start', attemptId, code: e.code };
    }
    if (e instanceof VoximplantNetworkError) {
      await markCallbackDispatchUnknown(attemptId, 'network_error_during_start');
      await alert('warn', 'Voximplant StartScenarios ambiguous for meeting-confirm call (start_unknown)', {
        callbackRequestId, attemptId,
      });
      return { kind: 'start_unknown', attemptId };
    }
    throw e; // truly unexpected — let the caller's own catch alert + rethrow
  }
}
