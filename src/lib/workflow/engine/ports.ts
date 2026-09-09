// The dependencies the workflow engine needs from the rest of KALFA, as
// interfaces rather than imports.
//
// Same shape and the same reason as `StepExecutionDeps` in
// src/lib/outreach/enqueue.ts: this module and everything downstream of it stay
// free of `server-only`, Supabase and pg-boss, so the engine and every step
// handler are unit-testable without a database. The worker wires the real
// implementations; the tests wire fakes and assert on what was called.
import type { RsvpStatus } from '@/lib/constants';

// ---------------------------------------------------------------------------
// The execution ledger
// ---------------------------------------------------------------------------

/**
 * The outcome of trying to claim a node's step row.
 *
 * `claimed` — this attempt owns the node and must perform its side effect.
 * `already_done` — a previous attempt finished it. The vendored `runGraph` keeps
 *   no per-node checkpoint, so a pg-boss retry replays the WHOLE graph from the
 *   start node; this is the answer that stops the second send. It carries the
 *   original result so the replayed graph routes exactly as it did the first
 *   time rather than re-deciding a branch on an empty one.
 * `in_flight` — another attempt holds the node right now. Distinct from
 *   `already_done` because it must NOT be treated as success: nothing has
 *   finished, and continuing downstream would run on a result that does not
 *   exist yet.
 *
 * A `running` row means one of two things, and THE ROW ALONE CANNOT TELL THEM
 * APART: another attempt is working on it, or an attempt died holding it. Two
 * mechanisms separate them, and the implementation needs both:
 *
 *   1. `singletonKey: runId` on the pg-boss send, so the same run is never
 *      delivered concurrently. (Same idiom as QUEUES.logExport.) With it, a
 *      `running` row found by a RETRY is necessarily abandoned, not contended.
 *   2. A staleness lease on `started_at`, so a genuinely abandoned row is
 *      reclaimable rather than poisoning the run forever.
 *
 * Without the lease, ANY crash makes a run permanently unrecoverable: the retry
 * meets the dead attempt's own `running` row on the very first node, reports
 * `in_flight`, and fails. Safe, but never durable.
 *
 * THE COST OF THE LEASE, stated plainly. Reclaiming reopens exactly one window:
 * a node whose side effect completed but whose `completeStep` never landed will
 * run a second time. So **every action node must be safe to call twice**, either
 * because the operation is naturally idempotent (`submit_rsvp` setting the same
 * status again is the same row) or because it carries its own deterministic
 * dedup key (the `detId` / `deferId` idiom in src/lib/outreach). `send_whatsapp`
 * will need the second kind. This is a rule about which actions may exist, not
 * an implementation detail of this file.
 */
export type StepClaim =
  | { kind: 'claimed' }
  | { kind: 'already_done'; result: unknown }
  | { kind: 'in_flight' };

export interface StepLedgerPort {
  /**
   * Claim the (runId, nodeId) row before the side effect. Backed by
   * `unique (run_id, node_id)`: a concurrent attempt gets 23505 and must be
   * reported as `in_flight` or `already_done` — never swallowed into a fresh
   * claim.
   *
   * A `running` row older than `STEP_LEASE_MS` is RECLAIMED (returns `claimed`,
   * with `started_at` reset). Younger than that, it is `in_flight`. See the
   * StepClaim comment for why both halves are required.
   */
  claimStep(args: {
    runId: string;
    nodeId: string;
    nodeType: string;
  }): Promise<StepClaim>;

  /**
   * Record the node's finished result.
   *
   * `result` is the WHOLE `NodeExecutionResult` — `{ output, nextPort? }` — not
   * just its `output` field, and `claimStep` must hand exactly this back as
   * `already_done.result`. The distinction is the difference between a correct
   * replay and a wrong one: `nextPort` is the branch a condition node chose, and
   * a replay that lost it would re-decide the branch on an empty value and could
   * run a subtree that never ran.
   *
   * The `workflow_run_steps.output` column therefore holds the full result. The
   * column name is the runner's word for it, kept rather than renamed so the row
   * and the port read the same in a log.
   */
  completeStep(args: {
    runId: string;
    nodeId: string;
    result: unknown;
  }): Promise<void>;

  failStep(args: {
    runId: string;
    nodeId: string;
    message: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Run status
// ---------------------------------------------------------------------------

// Mirrors the workflow_runs.status check constraint, which in turn mirrors
// ExecutionStatus in the vendored runner. Three lists, one vocabulary.
export type RunStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled';

/**
 * How long a claimed-but-unfinished step is presumed live.
 *
 * Follows the 15-minute window `voximplant-reconcile` already uses for
 * pre-terminal rows, for the same reason: it is comfortably longer than any
 * single step should take, so a reclaim inside it would be a false positive,
 * and short enough that a crashed run recovers on the next retry rather than
 * on a human's next glance at the dashboard.
 */
export const STEP_LEASE_MS = 15 * 60 * 1000;

export interface RunStorePort {
  /**
   * Write the run's status. The implementation also stamps `finished_at` when
   * the status is terminal ('completed' | 'incomplete' | 'failed' |
   * 'cancelled') — this is the only writer of that column, so a run with a
   * terminal status and a null `finished_at` would be a bug in the store rather
   * than a state the engine can produce.
   */
  setRunStatus(args: {
    runId: string;
    status: RunStatus;
    errorMessage?: string;
  }): Promise<void>;
}

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'incomplete',
  'failed',
  'cancelled',
];

// ---------------------------------------------------------------------------
// What the action nodes are allowed to do
// ---------------------------------------------------------------------------

// Deliberately narrow. A step handler cannot reach a Supabase client, only these
// named operations — so the set of things a workflow can do to a guest is
// readable in one place instead of inferred from every handler.
export interface GuestActionsPort {
  /**
   * Guests behind one contact. A phone may back several guests (guests.contact_id
   * is not unique), which is why this returns a list and the handler refuses to
   * guess — see the comment in webhook-processing.ts.
   */
  getGuestsForContact(
    eventId: string,
    contactId: string,
  ): Promise<{ id: string; rsvp_token: string }[]>;

  /**
   * Record an RSVP through the same atomic `submit_rsvp` gate the public form
   * uses. No RSVP rule is reimplemented in a workflow step.
   */
  submitRsvp(
    token: string,
    input: { status: RsvpStatus; adults: number; kids: number },
  ): Promise<{ ok: boolean; reason?: string }>;

  /** The activity-log entry, so an automated change is as auditable as a manual one. */
  recordRsvpFromWhatsapp(
    eventId: string,
    guestId: string,
    status: RsvpStatus,
  ): Promise<void>;
}

/**
 * The execution event log — append-only, ordered, one row per emitted event.
 *
 * The vendored `runGraph` already emits exactly the events a live canvas replay
 * needs; until now we discarded them. This port is where they land.
 *
 * NOT the same thing as the step ledger, and the difference matters: the ledger
 * is a SET (one row per node, unique, claimed before the side effect) and this
 * is a LOG (a node appears more than once when a pg-boss retry replays the
 * graph). Folding them together would either break the uniqueness that stops a
 * second send, or lose the ordering the canvas replays from.
 *
 * Optional: a dry run has no rows to write, and execution must not depend on the
 * log being available — a failure to record an event is never a reason to fail a
 * run that is otherwise healthy.
 */
export interface ExecutionLogPort {
  appendEvent(args: {
    runId: string;
    type: string;
    nodeId?: string;
    payload?: unknown;
  }): Promise<void>;
}

export type WorkflowEngineDeps = {
  ledger: StepLedgerPort;
  runs: RunStorePort;
  guests: GuestActionsPort;
  /** Omitted by the dry run, which returns its trace directly. */
  log?: ExecutionLogPort;
};
