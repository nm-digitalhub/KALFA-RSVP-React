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

/**
 * "Read" + "typing…" (capabilities plan §4.1): one Graph call, cut off after
 * this long. It is on the critical path TWICE: the first call is awaited
 * before the run, and the refresh in flight when the run ends (flag on) is
 * awaited before the send gate — so the chain counts it twice.
 */
export const OWNER_AGENT_TYPING_TIMEOUT_MS = 5_000;

/**
 * Every media download of one turn together (§4.2): the scoped lookup and the
 * download of each file share this deadline, so a burst of files cannot
 * multiply it. A file whose turn ran out of time is "unreadable".
 */
export const OWNER_AGENT_MEDIA_BUDGET_MS = 15_000;
/** The scoped metadata lookup of one file, within the budget above. */
export const OWNER_AGENT_MEDIA_LOOKUP_TIMEOUT_MS = 5_000;
/** Files downloaded per turn at most; the rest of a burst's files are "unreadable". */
export const OWNER_AGENT_MAX_MEDIA_PER_TURN = 3;

/** The one interactive follow-up message after the answer's text parts (§4.3). */
export const OWNER_AGENT_INTERACTIVE_SEND_MS = 15_000;

/** One answer, end to end, at most. */
export const OWNER_AGENT_REPLY_MAX_MS =
  OWNER_AGENT_RESUME_FAIL_FAST_MS +
  OWNER_AGENT_RUN_TIMEOUT_MS +
  OWNER_AGENT_RUN_KILL_AFTER_MS +
  OWNER_AGENT_REPLY_OVERHEAD_MS +
  2 * OWNER_AGENT_TYPING_TIMEOUT_MS +
  OWNER_AGENT_MEDIA_BUDGET_MS +
  OWNER_AGENT_INTERACTIVE_SEND_MS;

/**
 * The typing refresh during a run (§4.1): Meta clears the indicator after 25s,
 * and whether a second read call re-shows it is not documented — so it is off
 * unless OWNER_AGENT_TYPING_REFRESH_MS says otherwise. A value outside
 * [5000, 24000] (or not a whole number) is off.
 */
export const OWNER_AGENT_TYPING_REFRESH_ENV = 'OWNER_AGENT_TYPING_REFRESH_MS';
export function typingRefreshMs(raw: string | undefined): number {
  if (raw === undefined || !/^[0-9]{1,6}$/.test(raw.trim())) return 0;
  const ms = Number(raw.trim());
  return ms >= 5_000 && ms <= 24_000 ? ms : 0;
}

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
