import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
// Type-only import — erased at compile time, so this module never pulls the
// dispatcher's runtime graph (voximplant mutations etc.) into the web bundle.
import type { CallDispatchResult } from '@/lib/data/outreach-calls';
import type { OutreachCallRequest } from '@/lib/queue/queues';

// call_dispatch_status — the app's post-202 truth channel for MANUAL dials.
//
// A row is a DISPATCH REQUEST, not a call: the route inserts it as 'accepted'
// BEFORE enqueueing (so every 202 has a row), and the worker settles it with a
// CLOSED public status/reason mapped from CallDispatchResult. The app receives
// the settle over Realtime (postgres_changes) and can poll by dispatch_id after
// a reconnect. skipped/already_reached is a valid domain refusal, not an error.
//
// The vocabulary here is a CONTRACT with the Android app and with the DB CHECK
// constraints (migration 20260722170740). Extending either union is a
// deliberate contract change: update the migration, this file, and the app
// mapping together — the corpus test (call-dispatch-status.test.ts) fails if
// the TS unions and the SQL CHECK lists drift apart, and the exhaustive mapper
// below makes an unmapped worker outcome a compile error, so the CHECK can
// never be hit by surprise at runtime.

export type DispatchPublicStatus =
  | 'accepted'
  | 'dispatched'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'unknown';

export const DISPATCH_STATUS_VALUES: readonly DispatchPublicStatus[] = [
  'accepted',
  'dispatched',
  'skipped',
  'blocked',
  'failed',
  'unknown',
] as const;

export type DispatchPublicReason =
  | 'already_reached'
  | 'no_call_consent'
  | 'dnc_listed'
  | 'campaign_not_active'
  | 'event_closed'
  | 'concurrent_owner'
  | 'max_concurrency'
  | 'campaign_hour_cap'
  | 'outreach_disabled'
  | 'config_missing'
  | 'live_calls_disabled'
  | 'balance_below_reserve'
  | 'already_dispatched'
  | 'already_concluded'
  | 'failed_to_start'
  | 'start_unknown'
  | 'temporary_dispatch_failure';

export const DISPATCH_REASON_VALUES: readonly DispatchPublicReason[] = [
  'already_reached',
  'no_call_consent',
  'dnc_listed',
  'campaign_not_active',
  'event_closed',
  'concurrent_owner',
  'max_concurrency',
  'campaign_hour_cap',
  'outreach_disabled',
  'config_missing',
  'live_calls_disabled',
  'balance_below_reserve',
  'already_dispatched',
  'already_concluded',
  'failed_to_start',
  'start_unknown',
  'temporary_dispatch_failure',
] as const;

export type DispatchSettlement = {
  status: Exclude<DispatchPublicStatus, 'accepted'>;
  reason: DispatchPublicReason | null;
  attemptId: string | null;
};

// transient_error is deliberately NOT mappable — it is not a final outcome
// while pg-boss will retry. The worker settles temporary_dispatch_failure
// explicitly on the LAST permitted delivery (settleDispatchFailure below).
type FinalDispatchResult = Exclude<CallDispatchResult, { kind: 'transient_error' }>;

/**
 * The closed worker→public mapping (binding user decision, 2026-07-22).
 *
 * Two deliberate crosswalks:
 * - outreach_disabled arrives as kind 'skipped' but is published as 'blocked':
 *   the service being off is a system condition, not a per-contact business
 *   refusal, and the app renders those differently.
 * - already_dispatched / already_concluded publish as 'dispatched' linked to
 *   the WINNER's attempt row — a lost race is a valid outcome tied to the call
 *   that actually exists, never a failure.
 */
export function mapDispatchResult(result: FinalDispatchResult): DispatchSettlement {
  switch (result.kind) {
    case 'dialed':
      return { status: 'dispatched', reason: null, attemptId: result.attemptId };
    case 'already_dispatched':
      return { status: 'dispatched', reason: 'already_dispatched', attemptId: result.attemptId };
    case 'already_concluded':
      return { status: 'dispatched', reason: 'already_concluded', attemptId: result.attemptId };
    case 'skipped':
      if (result.reason === 'outreach_disabled') {
        return { status: 'blocked', reason: 'outreach_disabled', attemptId: null };
      }
      return { status: 'skipped', reason: result.reason, attemptId: null };
    case 'blocked':
      return { status: 'blocked', reason: result.reason, attemptId: null };
    case 'failed_to_start':
      return { status: 'failed', reason: 'failed_to_start', attemptId: result.attemptId };
    case 'start_unknown':
      // The call MAY have gone out. Never rendered as a failure, never redial
      // bait — the app must not offer a retry for this state.
      return { status: 'unknown', reason: 'start_unknown', attemptId: result.attemptId };
    default: {
      // Compile-time totality: a new CallDispatchResult kind fails here before
      // it can ever reach the DB CHECK at runtime.
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

type DispatchInsert = Database['public']['Tables']['call_dispatch_status']['Insert'];

/**
 * Route-side: create the 'accepted' row BEFORE boss.send. Returns false on
 * failure so the route can answer 500 WITHOUT enqueueing — the contract is
 * "every 202 has an accepted row", so a request whose status cannot be
 * recorded is refused rather than dialled blind.
 */
export async function recordDispatchAccepted(args: {
  dispatchId: string;
  eventId: string;
  contactId: string;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const row: DispatchInsert = {
      dispatch_id: args.dispatchId,
      event_id: args.eventId,
      contact_id: args.contactId,
      status: 'accepted',
    };
    const { error } = await admin.from('call_dispatch_status').insert(row);
    if (error) {
      console.error('[call-dispatch-status] accepted insert failed', {
        dispatchId: args.dispatchId,
        code: error.code,
      });
    }
    return !error;
  } catch (e) {
    console.error('[call-dispatch-status] accepted insert threw', {
      dispatchId: args.dispatchId,
      detail: e instanceof Error ? e.message : 'unknown error',
    });
    return false;
  }
}

/**
 * Settle a dispatch row to a final public state. UPSERT, not update: a job
 * enqueued by a pre-deploy route has no 'accepted' row, and the app still
 * deserves its answer (version-skew tolerance).
 *
 * STRICT — a failed settle THROWS (after logging ids + error code, no PII).
 * This is deliberately the opposite contract from recordManualDialOutcome:
 * the activity_log half is a best-effort audit, but this row is the ANSWER the
 * app is waiting on. Swallowing a failure here would let the worker complete
 * the job with the row stuck 'accepted' forever — the exact "no worker path
 * leaves a 202 unanswered" contract violation. Throwing instead fails the job,
 * so pg-boss redelivers (CALL_RETRY): the re-dispatch is dial-safe (the
 * attempt row already exists → reconcile, never a second StartScenarios — the
 * same recovery case 16 pins for insertInteraction), and the settle gets
 * another attempt. If every retry fails, the job lands in pg-boss `failed`
 * WITH a Slack alert (guardedWorker) — never a silent success.
 */
export async function settleDispatch(args: {
  dispatchId: string;
  eventId: string;
  contactId: string;
  settlement: DispatchSettlement;
}): Promise<void> {
  const admin = createAdminClient();
  const row: DispatchInsert = {
    dispatch_id: args.dispatchId,
    event_id: args.eventId,
    contact_id: args.contactId,
    status: args.settlement.status,
    reason: args.settlement.reason,
    call_attempt_id: args.settlement.attemptId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from('call_dispatch_status')
    .upsert(row, { onConflict: 'dispatch_id' });
  if (error) {
    console.error('[call-dispatch-status] settle failed', {
      dispatchId: args.dispatchId,
      status: args.settlement.status,
      code: error.code,
    });
    throw new Error(`call_dispatch_status settle failed: ${error.code ?? 'unknown'}`);
  }
}

/**
 * Settle failed/temporary_dispatch_failure — the two paths that end a request
 * without a dispatcher verdict: the route's enqueue failure (502) and the
 * worker's transient-error retry exhaustion. A public, classified reason —
 * never the underlying exception text. STRICT like settleDispatch; each caller
 * decides what a throw means (the route must still answer 502 — it catches;
 * the worker's exhaustion path logs and rethrows the ORIGINAL transient error).
 */
export async function settleDispatchFailure(args: {
  dispatchId: string;
  eventId: string;
  contactId: string;
}): Promise<void> {
  await settleDispatch({
    dispatchId: args.dispatchId,
    eventId: args.eventId,
    contactId: args.contactId,
    settlement: { status: 'failed', reason: 'temporary_dispatch_failure', attemptId: null },
  });
}

/**
 * Worker-side: publish the final outcome of a MANUAL dispatch. No-op unless
 * the job is isManual AND carries a dispatchId — campaign and callback jobs
 * have no dispatch row (their surfaces are outreach_state / console_call_feed).
 *
 * STRICT (propagates settleDispatch's throw): a failed publish FAILS the job
 * so pg-boss redelivers and the answer is retried — never a completed job
 * with a row stuck 'accepted'.
 */
export async function settleManualDispatch(
  job: OutreachCallRequest,
  result: FinalDispatchResult,
): Promise<void> {
  if (!job.isManual || !job.dispatchId) return;
  await settleDispatch({
    dispatchId: job.dispatchId,
    eventId: job.eventId,
    contactId: job.contactId,
    settlement: mapDispatchResult(result),
  });
}

const RETENTION_DAYS = 30;

/**
 * Daily retention sweep (call-dispatch-retention cron): the table is a status
 * channel, not an audit log — activity_log 'call.manual_dispatch' remains the
 * durable record. Deleting by created_at also clears version-skew stragglers
 * (rows whose job predates a deploy and was never settled). Never throws.
 */
export async function runDispatchRetention(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const admin = createAdminClient();
    const { error } = await admin.from('call_dispatch_status').delete().lt('created_at', cutoff);
    if (error) {
      console.error('[call-dispatch-status] retention sweep failed', { code: error.code });
    }
  } catch (e) {
    // Never throws — a failed sweep just runs again tomorrow. Logged, not
    // silent: unbounded growth is the failure mode this cron exists to stop.
    console.error('[call-dispatch-status] retention sweep threw', {
      detail: e instanceof Error ? e.message : 'unknown error',
    });
  }
}
