import { OWNER_AGENT_RUN_KILL_AFTER_MS } from '@/lib/owner-agent/consumer/budgets';

import { REPORT_CATCH_UP_MS } from './planner';

// The report handler's time budgets, as one chain — the reports twin of
// consumer/budgets.ts, and pinned by budgets.test.ts against that file's
// OWNER_AGENT_STOP_TIMEOUT_MS (imported, not repeated):
//
//   one report = the core reads (bounded below) + gates twice, audit, sends
//   < expireInSeconds   — pg-boss takes a job away only after the handler
//                         could have finished on its own terms
//   < stop timeout      — the process's graceful stop waits for a report in
//                         flight as it waits for an answer
//
// And the retry chain fits inside the catch-up window: a report retried after a
// database blip must still be on time, or the handler expires it.
//
// There is no model run here: a report is a handful of head-count queries and
// at most six WhatsApp sends, so the numbers are seconds, not minutes.

/** The content reads (six cores in parallel) must finish within this, or the job throws and retries. */
export const REPORT_CONTENT_TIMEOUT_MS = 30_000;

/**
 * Everything else: the run and subscription reads, the gate twice (settings,
 * allow-list row, staff, verified phone, six permission RPCs), the channel
 * read, up to MAX_REPLY_PARTS text sends plus one template fallback, the result
 * and the audit. Generous on purpose, as in consumer/budgets.ts.
 */
export const REPORT_OVERHEAD_MS = 45_000;

/** One report, end to end, at most. */
export const REPORT_MAX_MS = REPORT_CONTENT_TIMEOUT_MS + REPORT_OVERHEAD_MS;

/** QUEUES.ownerAgentReport expireInSeconds (set by consumer/main.ts at start). */
export const REPORT_EXPIRE_SECONDS = 150;

// Set on every start so every job the tick sends inherits it. Retries cover a
// database blip BEFORE the send claim; after the claim nothing throws
// (report.ts), so a retry can never send twice.
export const REPORT_QUEUE_POLICY = {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: REPORT_EXPIRE_SECONDS,
} as const;

/**
 * The longest a job can take from its first attempt to the end of its last:
 * every attempt may run to expiry, and pg-boss's backoff doubles the delay
 * (retryDelay, 2×retryDelay, …).
 */
export function reportRetryChainMs(
  policy: { retryLimit: number; retryDelay: number; retryBackoff: boolean; expireInSeconds: number } = REPORT_QUEUE_POLICY,
): number {
  let total = policy.expireInSeconds * 1000;
  for (let attempt = 1; attempt <= policy.retryLimit; attempt += 1) {
    const delay = policy.retryBackoff ? policy.retryDelay * 2 ** (attempt - 1) : policy.retryDelay;
    total += delay * 1000 + policy.expireInSeconds * 1000;
  }
  return total;
}

// ── Model-backed reports (a subscription with instructions) ──────────────────
// These run on QUEUES.ownerAgentReply, not on the report queue: that queue's
// single worker (batchSize 1, localConcurrency 1) is what makes "one model run
// at a time in this process" true for answers, and a model report joins the
// same line instead of adding a second one (report.ts). So a model report lives
// inside the REPLY queue's policy — consumer/budgets.ts
// OWNER_AGENT_REPLY_QUEUE_POLICY, expiry 300s — and budgets.test.ts asserts it
// fits there, retries included, inside the catch-up window.

/** The model run of a report (the runner's timeoutMs). */
export const REPORT_MODEL_RUN_TIMEOUT_MS = 180_000;

/**
 * A model report, end to end, at most: the run and its SIGKILL grace, then —
 * if the run failed — the deterministic content as the fallback, plus the
 * same gates, sends and audit as any report.
 */
export const REPORT_MODEL_MAX_MS =
  REPORT_MODEL_RUN_TIMEOUT_MS + OWNER_AGENT_RUN_KILL_AFTER_MS + REPORT_CONTENT_TIMEOUT_MS + REPORT_OVERHEAD_MS;

/** A 'queued' run younger than this is assumed to have its job in flight (the tick re-enqueues older ones). */
export const REPORT_STRANDED_AFTER_MS = 2 * 60 * 1000;

/** Rows per tick for the stranded and stale scans; the next tick takes the rest. */
export const REPORT_SWEEP_BATCH = 100;

// Re-exported so the chain's last link is visible next to the others.
export { REPORT_CATCH_UP_MS };
