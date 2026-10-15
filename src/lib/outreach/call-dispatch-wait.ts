import { createHash } from 'node:crypto';

import type { PgBoss } from 'pg-boss';

import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { CALL_RETRY, QUEUES, type OutreachCallRequest } from '@/lib/queue/queues';

// Waiting out a TEMPORARY refusal of a scheduled campaign call (openspec/changes/retry-scheduled-calls-on-transient-skips).
//
// dispatchOutreachCall refuses some dials only for now: the dial window is closed, every call slot is busy, the
// campaign's hourly cap is full, or the account balance is under the reserve. In each case the refusal happens before a
// call attempt row exists and before the provider is called. The worker used to complete the job on that result, and the
// round was lost for good (every skip completes the job: worker/main.ts). Instead the same payload is sent again after a
// wait that fits the reason, bounded by the end of the event day, and only then settled loudly.
//
// No double dial is possible: nothing was dialled, and each re-send has its own deterministic id per wait, so a
// redelivered job cannot enqueue the same wait twice (same reasoning as src/lib/dnc/registry-wait.ts).
//
// Everything else a dispatch can answer is NOT waited out, on purpose: a missing consent, a removal-list number, a guest
// who already answered, a closed event, a call another worker owns, and the provider outcomes (a failed or ambiguous
// start must never be dialled again) are final; the admin's own stops (kill switches, missing configuration, a paused
// campaign) are an owner decision, not a transient condition.

export const DEFERRABLE_REASONS = [
  'outside_dial_window',
  'max_concurrency',
  'campaign_hour_cap',
  'balance_below_reserve',
] as const;
export type DeferralReason = (typeof DEFERRABLE_REASONS)[number];

/** How long to wait before asking again, for the reasons that have no calendar answer (the dial window has one). */
export const RETRY_AFTER_MS: Record<Exclude<DeferralReason, 'outside_dial_window'>, number> = {
  max_concurrency: 3 * 60_000,
  campaign_hour_cap: 10 * 60_000,
  balance_below_reserve: 15 * 60_000,
};

/** Waits spread over this long after the earliest moment, so deferred calls do not all return at the same instant. */
const SPREAD_MS: Record<DeferralReason, number> = {
  outside_dial_window: 10 * 60_000,
  max_concurrency: 2 * 60_000,
  campaign_hour_cap: 5 * 60_000,
  balance_below_reserve: 5 * 60_000,
};

/** A loop guard (about 15 hours of the shortest wait). The real bound is the end of the event day. */
export const CALL_WAIT_MAX = 300;

export type CallWaitSettleReason = 'no_window_before_event_end' | 'wait_limit';

export type CallWaitDecision =
  | { action: 'defer'; wait: number; runAtMs: number }
  | { action: 'settle'; reason: CallWaitSettleReason };

type CallKey = Pick<OutreachCallRequest, 'campaignId' | 'contactId' | 'touchpointIndex'>;

function waitKey(job: CallKey): string {
  return `${job.campaignId}:${job.contactId}:${job.touchpointIndex}`;
}

/** When to ask again for a reason that is not tied to the calendar. */
export function retryNotBeforeMs(reason: Exclude<DeferralReason, 'outside_dial_window'>, nowMs: number): number {
  return nowMs + RETRY_AFTER_MS[reason];
}

export function callWaitJobId(job: CallKey, wait: number): string {
  return deterministicJobId(`call-dispatch-wait:${waitKey(job)}:${wait}`);
}

/** A stable offset in [0, span) per call, wait and reason: the same inputs always give the same moment. */
export function callWaitSpreadMs(job: CallKey, wait: number, reason: DeferralReason): number {
  const rand = createHash('sha1').update(`call-dispatch-spread:${waitKey(job)}:${wait}`).digest().readUInt32BE(0);
  return rand % SPREAD_MS[reason];
}

/**
 * Pure. `notBeforeMs` is the earliest moment worth asking again (null when there is none, e.g. the dial window does not
 * open inside the look-ahead); `expiryMs` is the end of the event day, the same cutoff the planner uses.
 */
export function decideCallWait(args: {
  job: CallKey & { dispatchWaits?: number };
  reason: DeferralReason;
  notBeforeMs: number | null;
  expiryMs: number;
}): CallWaitDecision {
  const waits = args.job.dispatchWaits ?? 0;
  if (waits >= CALL_WAIT_MAX) return { action: 'settle', reason: 'wait_limit' };
  if (args.notBeforeMs === null || args.notBeforeMs >= args.expiryMs) {
    return { action: 'settle', reason: 'no_window_before_event_end' };
  }
  const wait = waits + 1;
  const runAtMs = Math.min(args.notBeforeMs + callWaitSpreadMs(args.job, wait, args.reason), args.expiryMs - 1);
  return { action: 'defer', wait, runAtMs };
}

/** Re-sends the dial for the decided instant. The caller completes the current job only after this resolves. */
export async function deferCall(
  boss: Pick<PgBoss, 'send'>,
  data: OutreachCallRequest,
  decision: Extract<CallWaitDecision, { action: 'defer' }>,
): Promise<void> {
  await boss.send(
    QUEUES.callRequest,
    { ...data, dispatchWaits: decision.wait },
    {
      id: callWaitJobId(data, decision.wait),
      startAfter: new Date(decision.runAtMs),
      ...CALL_RETRY,
    },
  );
}
