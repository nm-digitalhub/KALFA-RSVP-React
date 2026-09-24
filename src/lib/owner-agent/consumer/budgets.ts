import { KILL_AFTER_MS } from '@/lib/owner-agent/runner';

// The reply consumer's time budgets, as one chain. Each value must be larger
// than the one before it, and budgets.test.ts asserts that — including the pm2
// kill_timeout in ecosystem.owner-agent.config.cjs (its own file, not an entry
// in ecosystem.config.cjs) — rather than leaving four files to agree by hand
// (the workflow engine's workflow-budgets.test.ts is the model).
//
//   one answer   = the model run + its SIGKILL grace + gates, audit and sends
//   < expireInSeconds  — pg-boss takes a job away from a handler only after
//                        the handler could have finished on its own terms
//   < stop timeout     — a graceful shutdown waits for an answer in flight
//                        instead of failing it into a retry that re-runs the model
//   < pm2 kill_timeout — pm2 does not SIGKILL the process while it waits
//
// Losing the ordering is not a crash, it is a second model run: a job expired
// under a live handler is re-delivered, and the retry pays for the answer
// again. It never sends twice — the intake status CAS (reply.ts) sees to that.

/**
 * How long one `claude -p` answer may run (the runner's timeoutMs). 180s since
 * free read (free-read plan §3.5): a free-SQL answer takes more turns, each
 * Supabase call 1–3s (measured 2026-09-24), within OWNER_AGENT_MAX_TURNS.
 */
export const OWNER_AGENT_RUN_TIMEOUT_MS = 180_000;

/** The model every answer runs on (an alias, as the CLI spells it). */
export const OWNER_AGENT_MODEL = 'sonnet';

/**
 * The CLI's --max-turns per answer. 12 since free read: primer → (at most) a
 * pg_catalog look-up → a query → a fixed query, and room for a follow-up.
 */
export const OWNER_AGENT_MAX_TURNS = 12;

/** The runner's SIGKILL grace after the timeout's SIGTERM. */
export const OWNER_AGENT_RUN_KILL_AFTER_MS = KILL_AFTER_MS;

/**
 * Everything around the run: the intake read, the gate (eight small queries),
 * the permission RPCs, up to five WhatsApp sends (MAX_REPLY_PARTS) and the audit. Generous on
 * purpose — the pooler's measured ~134ms round trip times twenty is ~3s.
 */
export const OWNER_AGENT_REPLY_OVERHEAD_MS = 50_000;

/**
 * A resumed run that fails within this long is retried once as a fresh
 * session (reply.ts). A session file that is gone fails in seconds; a failure
 * that took longer was a real run, and is not repeated — so a retry can add at
 * most this much before the fresh run's own timeout starts.
 */
export const OWNER_AGENT_RESUME_FAIL_FAST_MS = 15_000;

/** One answer, end to end, at most. */
export const OWNER_AGENT_REPLY_MAX_MS =
  OWNER_AGENT_RESUME_FAIL_FAST_MS +
  OWNER_AGENT_RUN_TIMEOUT_MS +
  OWNER_AGENT_RUN_KILL_AFTER_MS +
  OWNER_AGENT_REPLY_OVERHEAD_MS;

/** QUEUES.ownerAgentReply expireInSeconds (set by consumer/main.ts at start). */
export const OWNER_AGENT_REPLY_EXPIRE_SECONDS = 300;

// The reply queue's policy, set by consumer/main.ts on every start so every job
// the route sends ({ id } only, intake.ts) inherits it. Two retries with
// backoff cover a database blip before the send claim; after the claim nothing
// is retried (reply.ts), so a retry can never send twice.
export const OWNER_AGENT_REPLY_QUEUE_POLICY = {
  retryLimit: 2,
  retryDelay: 15,
  retryBackoff: true,
  expireInSeconds: OWNER_AGENT_REPLY_EXPIRE_SECONDS,
} as const;

/** boss.stop({ graceful: true, timeout }) on SIGINT/SIGTERM. */
export const OWNER_AGENT_STOP_TIMEOUT_MS = 310_000;

/** ecosystem.owner-agent.config.cjs kill_timeout — pinned by budgets.test.ts. */
export const OWNER_AGENT_PM2_KILL_TIMEOUT_MS = 330_000;

/**
 * This process's pg-boss pool. The database role has ~15 session-mode slots
 * (worker/main.ts), and the other holders are the worker's pool (8), its
 * job-meta pool (2) and the web tier's send-only sender (2) — 12. Two here
 * leaves one slot free even with everything at its maximum; three would fill
 * the last one, and the process refused a connection could be the worker
 * that drives guests (review 2026-09-24). budgets.test.ts reads the other
 * three pool sizes from their files.
 */
export const OWNER_AGENT_DB_POOL_MAX = 2;
