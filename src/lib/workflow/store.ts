import 'server-only';

// The Supabase side of the workflow engine: the three ports, plus the reads and
// writes the drain and the admin pages need.
//
// service_role throughout. RLS does not apply to it, which is why the migration
// grants `authenticated` only SELECT on runs and steps: an admin can read the
// execution record through the cookie client, and only the worker can write it.
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

import {
  STEP_LEASE_MS,
  TERMINAL_RUN_STATUSES,
  type ExecutionLogPort,
  type RunStorePort,
  type StepClaim,
  type StepLedgerPort,
} from './engine/ports';
import type { ArmedWorkflow, PlannedRun } from './trigger';

// Postgres unique-violation. The claim below is built on it, so it is named
// rather than matched inline.
const UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------------------
// The step ledger
// ---------------------------------------------------------------------------

export function createStepLedger(): StepLedgerPort {
  const supabase = createAdminClient();

  return {
    async claimStep({ runId, nodeId, nodeType }): Promise<StepClaim> {
      // Try to take the row. `unique (run_id, node_id)` decides the race: with
      // two attempts inserting at once, exactly one succeeds and the other gets
      // 23505 — which is the whole reason the constraint exists.
      const insert = await supabase
        .from('workflow_run_steps')
        .insert({
          run_id: runId,
          node_id: nodeId,
          node_type: nodeType,
          status: 'running',
        })
        .select('id')
        .single();

      if (!insert.error) return { kind: 'claimed' };

      if (insert.error.code !== UNIQUE_VIOLATION) {
        // Anything else is a genuine failure. Never degraded into a claim: a
        // swallowed error here is a second side effect.
        throw new Error(`claimStep failed: ${insert.error.message}`);
      }

      // The row already exists. Which of the three states is it in?
      const existing = await supabase
        .from('workflow_run_steps')
        .select('status, output, started_at, wait_until')
        .eq('run_id', runId)
        .eq('node_id', nodeId)
        .single();

      if (existing.error || !existing.data) {
        throw new Error(
          `claimStep: row conflicted but could not be read (${existing.error?.message ?? 'missing'})`,
        );
      }

      const row = existing.data;

      // Finished. The replay path — hand back the whole stored result so the
      // graph routes exactly as it did the first time.
      if (row.status === 'completed' || row.status === 'skipped') {
        return { kind: 'already_done', result: row.output };
      }

      // PARKED by a `logic.wait`. The deadline decides, and nothing else may:
      // the 15-minute lease must not touch this row, or a 3-day wait would be
      // reclaimed and restarted every quarter of an hour and never elapse.
      if (row.status === 'waiting') {
        const waitUntil = Date.parse(row.wait_until ?? '');
        // An unparseable deadline is treated as PASSED rather than as forever.
        // A row that can never be claimed again is a run stuck with no way out,
        // and the node itself is safe to re-enter — it simply completes.
        const elapsed = !Number.isFinite(waitUntil) || Date.now() >= waitUntil;
        if (!elapsed) return { kind: 'in_flight' };

        const woken = await takeOverWaitingRow(supabase, runId, nodeId, nodeType);
        return woken ? { kind: 'claimed', resumedFromWait: true } : { kind: 'in_flight' };
      }

      // 'failed' left by a previous attempt: retryable, so take it over. The
      // node did not finish, and nothing downstream ran on it.
      if (row.status === 'failed') {
        const retaken = await takeOverFailedRow(supabase, runId, nodeId, nodeType);
        return retaken ? { kind: 'claimed' } : { kind: 'in_flight' };
      }

      // 'running'. The row alone cannot say whether a live attempt holds it or a
      // dead one abandoned it, so the lease decides. Inside the window, presume
      // live. Past it, presume dead and take over — without this, ANY crash
      // makes the run permanently unrecoverable, because the retry meets the
      // dead attempt's own row on the very first node.
      const startedAt = Date.parse(row.started_at);
      const expired = Number.isFinite(startedAt) && Date.now() - startedAt > STEP_LEASE_MS;
      if (!expired) return { kind: 'in_flight' };

      const retaken = await takeOverExpiredRow(supabase, runId, nodeId, nodeType);
      return retaken ? { kind: 'claimed' } : { kind: 'in_flight' };
    },

    async completeStep({ runId, nodeId, result }) {
      const { error } = await supabase
        .from('workflow_run_steps')
        .update({
          status: 'completed',
          // The WHOLE NodeExecutionResult, `{ output, nextPort }` — not just its
          // `output` field. `nextPort` is the branch a condition chose, and a
          // replay that lost it could route down the other path.
          output: (result ?? null) as Json,
          finished_at: new Date().toISOString(),
        })
        .eq('run_id', runId)
        .eq('node_id', nodeId);

      if (error) throw new Error(`completeStep failed: ${error.message}`);
    },

    async beginWait({ runId, nodeId, waitUntil }) {
      // The row is ALREADY claimed by this attempt (status 'running'), so this is
      // a state change on a row we hold, not a race. Scoped to 'running' anyway:
      // a row someone else already moved on must not be dragged back into a wait.
      const { error } = await supabase
        .from('workflow_run_steps')
        .update({ status: 'waiting', wait_until: waitUntil })
        .eq('run_id', runId)
        .eq('node_id', nodeId)
        .eq('status', 'running');

      if (error) throw new Error(`beginWait failed: ${error.message}`);
    },

    async failStep({ runId, nodeId, message }) {
      const { error } = await supabase
        .from('workflow_run_steps')
        .update({
          status: 'failed',
          error_message: message.slice(0, 1000),
          finished_at: new Date().toISOString(),
        })
        .eq('run_id', runId)
        .eq('node_id', nodeId);

      if (error) throw new Error(`failStep failed: ${error.message}`);
    },
  };
}

// The fields a takeover writes. Identical for both cases below; only the
// predicate differs.
function takeoverPatch(nodeType: string) {
  return {
    status: 'running',
    node_type: nodeType,
    started_at: new Date().toISOString(),
    finished_at: null,
    error_message: null,
  };
}

/**
 * Take over a row a previous attempt left FAILED.
 *
 * Compare-and-set, not a blind update: `.eq('status','failed')` re-checks the
 * condition at write time rather than trusting the read a moment earlier, so a
 * row that finished in the gap is not clobbered, and two workers racing to
 * reclaim it resolve to one winner. The loser matches zero rows and reports
 * `in_flight` — correctly, because by then someone really is holding it.
 */
async function takeOverFailedRow(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  nodeId: string,
  nodeType: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('workflow_run_steps')
    .update(takeoverPatch(nodeType))
    .eq('run_id', runId)
    .eq('node_id', nodeId)
    .eq('status', 'failed')
    .select('id');

  if (error) throw new Error(`claimStep takeover (failed) failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Take over a WAITING row whose deadline has passed.
 *
 * Same compare-and-set shape as the failed case, and the predicate matters for
 * the same reason twice over: two workers waking the same run must resolve to
 * one winner, and a row whose deadline was EXTENDED between the read and the
 * write must not be dragged out of its wait.
 *
 * `wait_until` is cleared by `takeoverPatch` leaving it alone — it is not reset
 * here on purpose, so a row that is woken and then parks again overwrites it
 * with its new deadline rather than carrying a stale one.
 */
async function takeOverWaitingRow(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  nodeId: string,
  nodeType: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('workflow_run_steps')
    .update(takeoverPatch(nodeType))
    .eq('run_id', runId)
    .eq('node_id', nodeId)
    .eq('status', 'waiting')
    .select('id');

  if (error) throw new Error(`claimStep takeover (waiting) failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Take over a RUNNING row whose lease has expired — the crashed-worker case.
 *
 * Deliberately NOT written as a single `.or(...)` with the failed case. A
 * PostgREST `or=` string is parsed on `.`, `,`, `(` and `)`, and an ISO
 * timestamp contains two dots and a colon, so embedding `started_at.lt.<iso>`
 * inside one either needs exact quoting or silently misparses. Two plain
 * predicates cost one extra round trip on a path that only runs after a crash,
 * and they cannot be got subtly wrong: `.lt()` passes the timestamp as its own
 * filter value.
 *
 * The `.lt('started_at', cutoff)` is the CAS. Without it this would reclaim a
 * row a live worker had refreshed between the read and this write.
 */
async function takeOverExpiredRow(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  nodeId: string,
  nodeType: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - STEP_LEASE_MS).toISOString();

  const { data, error } = await supabase
    .from('workflow_run_steps')
    .update(takeoverPatch(nodeType))
    .eq('run_id', runId)
    .eq('node_id', nodeId)
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id');

  if (error) throw new Error(`claimStep takeover (expired) failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Run status
// ---------------------------------------------------------------------------

export function createRunStore(): RunStorePort {
  const supabase = createAdminClient();

  return {
    async setRunStatus({ runId, status, errorMessage, resumeAt, resumeCorrelationId }) {
      const terminal = TERMINAL_RUN_STATUSES.includes(status);

      const { error } = await supabase
        .from('workflow_runs')
        .update({
          status,
          ...(errorMessage ? { error_message: errorMessage.slice(0, 1000) } : {}),
          // The ONLY writer of finished_at. A terminal status always carries
          // one, so `status in (terminal) and finished_at is null` is a bug
          // signature rather than an ordinary state.
          ...(terminal ? { finished_at: new Date().toISOString() } : {}),
          // WRITTEN ON 'waiting', CLEARED ON EVERYTHING ELSE — unconditionally,
          // which is the point. The recovery index reads
          // `resume_at where status = 'waiting'`, so a run that woke and finished
          // while carrying a stale deadline would be re-delivered forever by a
          // sweep that believed it was still owed a wake-up.
          resume_at: status === 'waiting' ? (resumeAt ?? null) : null,
          // CLEARED ON EVERY NON-WAITING STATUS, for the same reason as
          // `resume_at` above and unconditionally like it. Nothing WRITES this
          // yet — the wait signal starts carrying a correlation in 0ב-2 — but
          // the clearing ships with the column so it can never be stale before
          // it is ever meaningful. A leftover id on a run that parked again for
          // an unrelated reason would be matched by an event that has nothing to
          // do with this wait, and woken early on it.
          resume_correlation_id: status === 'waiting' ? (resumeCorrelationId ?? null) : null,
        })
        .eq('id', runId)
        // TERMINAL IS FINAL. A run that has already ended cannot be moved by a
        // later write — the first terminal status wins and its finished_at
        // stands.
        //
        // Added 2026-09-09, and not defensively: the race is documented
        // upstream. `packages/temporal/.../cancellation-handling.decision-log.md`
        // lists it as a known con — "if runGraph has already emitted
        // execution_failed and is mid-updateStatus('failed') when the cancel
        // arrives … updateExecutionStatus overwrites 'failed' -> 'cancelled'" —
        // and records the close: "the terminal-state guard in database.ts; the
        // overwrite is now a no-op." We vendored their runner without their
        // guard.
        //
        // It is reachable here through pg-boss, not only through a cancel: the
        // job carries `singletonKey`, but a worker that loses its lease mid-run
        // while still executing lets a retry start a second attempt, and the
        // slower of the two would otherwise stamp the row last.
        //
        // A no-op update is NOT an error in PostgREST — zero rows matched
        // returns success — so a losing writer simply does nothing, which is
        // exactly what it should do.
        .not('status', 'in', `(${TERMINAL_RUN_STATUSES.join(',')})`);

      if (error) throw new Error(`setRunStatus failed: ${error.message}`);
    },
  };
}

// ---------------------------------------------------------------------------
// The execution event log
// ---------------------------------------------------------------------------

/**
 * Append-only event log, with writes SERIALIZED.
 *
 * The serialization is not tidiness — it is what makes the stream readable at
 * all. The SSE drain pages by `seq` and its cursor only moves forward, so an
 * event whose row becomes visible BELOW the cursor is never selected again and
 * is lost. `bigserial` allocates at INSERT and Postgres publishes at COMMIT, so
 * two inserts in flight together can commit out of order — and ours are: the
 * vendored `runGraph` executes each wave's nodes through `Promise.all`, so two
 * sibling nodes emit `node_started` at the same moment.
 *
 * Chaining every append onto the previous one makes allocation order and commit
 * order the same order. The reference backend upholds the same invariant on its
 * own side, by the same means.
 *
 * The chain never rejects: `appendEvent` swallows its own failure, so one bad
 * write cannot poison every later event in the run.
 */
export function createExecutionLog(): ExecutionLogPort {
  const supabase = createAdminClient();
  let tail: Promise<void> = Promise.resolve();

  return {
    appendEvent(args) {
      tail = tail.then(async () => {
        const { error } = await supabase.from('workflow_run_events').insert({
          run_id: args.runId,
          type: args.type,
          node_id: args.nodeId ?? null,
          payload: (args.payload ?? null) as Json,
        });
        // Swallowed on purpose. An event records something that already
        // happened; the caller in run-workflow.ts is fail-soft for the same
        // reason, and a rejected tail would break the chain for the rest of the
        // run.
        if (error) return;
      });
      return tail;
    },
  };
}

// ---------------------------------------------------------------------------
// Reads and writes around a run
// ---------------------------------------------------------------------------

/**
 * Runs that exist but have never been delivered.
 *
 * ⚠️ THIS CLOSES A GAP THAT PREDATES THE FAN-OUT. `createRunIfNew` and
 * `enqueueWorkflowRun` are two statements: every path that creates a run then
 * enqueues it, and a failure between the two has always left a row `pending`
 * with nothing coming for it — visible in /admin, invisible to the system,
 * recoverable only by hand.
 *
 * `action.start_for_each_guest` made it structural rather than rare: a step
 * handler has no queue handle by design, so its children are ALWAYS created
 * without one and this sweep is how they start.
 *
 * The window is the point. A row younger than `minAgeSeconds` may simply be
 * mid-enqueue on the path that created it, and picking it up would race that
 * path for the same job id — harmless (the id is deterministic) but pointless.
 * Anything older than that had its chance.
 */
/**
 * Parked runs whose deadline has passed and which nothing woke.
 *
 * ⚠️ THE HOLE THIS CLOSES. A `logic.wait` parks the run and relies on ONE
 * pg-boss job with a `startAfter`. That job is the only thing that will ever
 * wake it: `workflow_runs` has no other timer, and disarming the workflow does
 * not touch runs in flight. Lose the job — a queue purge, a failed insert, a
 * maintenance window — and the run sleeps for ever with nobody told.
 *
 * `listUndeliveredRuns` below covers the same class of loss for `pending` and
 * was written before `waiting` existed. This is its other half.
 *
 * `graceSeconds` keeps the sweep off the ordinary case: pg-boss fires a wake-up
 * within seconds of the deadline, so anything still parked minutes later is a
 * genuine loss rather than a race with the queue.
 *
 * Reads through `workflow_runs_resume_at_idx`, which is partial on
 * `status = 'waiting'` — the index was created with the wait itself.
 */
export async function listStuckWaitingRuns(
  graceSeconds = 300,
  limit = 200,
): Promise<{ runId: string; resumeAt: string }[]> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - graceSeconds * 1000).toISOString();

  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id, resume_at')
    .eq('status', 'waiting')
    .not('resume_at', 'is', null)
    .lt('resume_at', cutoff)
    .order('resume_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`listStuckWaitingRuns failed: ${error.message}`);
  return (data ?? [])
    .filter((r): r is { id: string; resume_at: string } => typeof r.resume_at === 'string')
    .map((r) => ({ runId: r.id, resumeAt: r.resume_at }));
}

export async function listUndeliveredRuns(
  minAgeSeconds = 30,
  limit = 200,
): Promise<string[]> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - minAgeSeconds * 1000).toISOString();

  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    // Oldest first: a backlog should drain in the order it accumulated, so a
    // run created an hour ago is not starved by one created a minute ago.
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`listUndeliveredRuns failed: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

/** Every armed workflow, for the drain to match an inbound message against. */
export async function listArmedWorkflows(): Promise<ArmedWorkflow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflows')
    .select('id, event_id, definition')
    .eq('is_active', true);

  if (error) throw new Error(`listArmedWorkflows failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    definition: row.definition,
  }));
}

/**
 * One workflow, by id, in the shape the trigger layer already speaks.
 *
 * The sibling of `listArmedWorkflows`, and deliberately WITHOUT its
 * `is_active` filter: arming decides whether a guest's message may start a
 * workflow, which is a different question from whether an admin may run one
 * on purpose. See the note in manual-run.ts.
 */
export async function loadWorkflowForRun(id: string): Promise<ArmedWorkflow | undefined> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflows')
    .select('id, event_id, definition')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`loadWorkflowForRun failed: ${error.message}`);
  if (!data) return undefined;

  return { id: data.id, eventId: data.event_id, definition: data.definition };
}

/**
 * Create the run row for a planned run, or return the id of the one that
 * already exists.
 *
 * `dedupe_key` carries the idempotency: `workflow_runs_dedupe_key_uidx` means a
 * Meta redelivery of the same inbound message, or two workers draining the same
 * inbox row, produce ONE run. A 23505 here is the expected happy path of a
 * retry, not an error — hence the read-back rather than a throw.
 *
 * Returns `undefined` when the run already existed, so the caller enqueues
 * nothing: the first creator already did.
 */
export async function createRunIfNew(planned: PlannedRun): Promise<string | undefined> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('workflow_runs')
    .insert({
      workflow_id: planned.workflowId,
      event_id: planned.eventId,
      // From the PLAN, not a literal. This used to read 'whatsapp_inbound',
      // which made the store the one file every new way of starting a workflow
      // had to edit — for a column whose own comment says the set is meant to
      // grow. See `PlannedRun.triggerSource`.
      trigger_source: planned.triggerSource,
      trigger_payload: planned.triggerPayload as unknown as Json,
      dedupe_key: planned.dedupeKey,
      // What this run resumes on if it parks. See `PlannedRun.definitionSnapshot`.
      definition_snapshot: planned.definitionSnapshot as Json,
      status: 'pending',
    })
    .select('id')
    .single();

  if (!error) return data.id;
  if (error.code === UNIQUE_VIOLATION) return undefined;

  throw new Error(`createRunIfNew failed: ${error.message}`);
}

export type RunForExecution = {
  runId: string;
  workflowId: string;
  storedDefinition: unknown;
  /**
   * The definition this run was created with, or null on a row created before
   * the column existed. Those keep today's behaviour — the live definition —
   * which is why the column is nullable and nothing was backfilled.
   */
  definitionSnapshot: unknown;
  triggerPayload: Record<string, unknown>;
  status: string;
};

/**
 * Everything the worker needs to execute a run, read fresh from the row.
 *
 * The job payload carries only the run id — never the message, never a phone —
 * so guest PII stays out of pg-boss's job table and its retry history. This is
 * where it is picked up instead.
 */
export async function loadRunForExecution(
  runId: string,
): Promise<RunForExecution | undefined> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id, workflow_id, status, trigger_payload, definition_snapshot, workflows(definition)')
    .eq('id', runId)
    .single();

  if (error || !data) return undefined;

  const workflow = data.workflows as { definition: Json } | null;
  if (!workflow) return undefined;

  return {
    runId: data.id,
    workflowId: data.workflow_id,
    storedDefinition: workflow.definition,
    /**
     * What this run was CREATED with — null on a row that predates the column.
     *
     * Returned ALONGSIDE the live definition rather than replacing it: which one
     * applies depends on the run's status, and that is the caller's call. See
     * `handleWorkflowRun`.
     */
    definitionSnapshot: data.definition_snapshot ?? null,
    triggerPayload: (data.trigger_payload ?? {}) as Record<string, unknown>,
    status: data.status,
  };
}
