// Enqueue one workflow run, and execute one.
//
// Kept free of `server-only` so the worker can bundle it; the Supabase access it
// needs arrives through the store, which is server-only and imported by the
// worker process (not by the browser).
import type { PgBoss } from 'pg-boss';

import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES, WORKFLOW_RETRY, type WorkflowRunJob } from '@/lib/queue/queues';
import { getAppOrigin } from '@/lib/url';

import { runWorkflow, type RunWorkflowOutcome } from './engine/run-workflow';
import { createGuestActions } from './guest-actions';
import { createTeamAlerts } from './team-alerts';
import { createOutboundWebhook } from './outbound-webhook';
import type { WorkflowTriggerPayload } from './steps';
import {
  createExecutionLog,
  createRunStore,
  createStepLedger,
  listStuckWaitingRuns,
  loadRunForExecution,
} from './store';

/**
 * Send the job for a run whose row already exists.
 *
 * Two independent guards, and both are needed:
 *
 *   `id` — a deterministic uuid over the run id, so a duplicated enqueue is a
 *     no-op (boss.send returns null on a PK conflict). Hashed through
 *     `deterministicJobId` rather than passed raw, because pg-boss's id column
 *     is a uuid and a composite string throws 22P02.
 *
 *   `singletonKey` — pg-boss will not have two jobs for the same run active at
 *     once. This is what makes the ledger's `in_flight` answer meaningful: with
 *     it, a `running` step row found by a retry can only have been abandoned by
 *     a dead attempt, never contended by a live one. Same idiom as
 *     QUEUES.logExport's "singleton so a manual run never overlaps the cron".
 */
export async function enqueueWorkflowRun(
  boss: PgBoss,
  runId: string,
  /**
   * When the job should become eligible. Omitted for a first delivery; set to a
   * `logic.wait` deadline when a parked run is re-scheduled.
   *
   * pg-boss holds the delay itself — the same mechanism the outreach sender uses
   * to defer a send into a window — so no sweep is needed for the ordinary case.
   */
  startAfter?: Date,
): Promise<void> {
  const data: WorkflowRunJob = { runId };
  await boss.send(QUEUES.workflowRun, data, {
    // ⚠️ THE JOB ID MUST DIFFER PER WAKE-UP. It is deterministic over the run id
    // so a duplicated enqueue is a no-op — exactly right for a first delivery,
    // and fatal for a resume: the completed job for this run still holds the id,
    // so a resume reusing it would be silently dropped and the run would sleep
    // for ever. The deadline is folded in, which keeps both properties: two
    // workers resuming the same park still collide on one id, and the next park
    // gets its own.
    id: deterministicJobId(
      startAfter ? `workflow-run:${runId}:${startAfter.toISOString()}` : `workflow-run:${runId}`,
    ),
    singletonKey: runId,
    ...(startAfter ? { startAfter } : {}),
    ...WORKFLOW_RETRY,
  });
}

/**
 * Execute one run, wiring the real dependencies.
 *
 * Reads everything fresh from the row: the job carries only the run id, so a
 * definition edited between enqueue and execution is picked up as it now stands
 * — which is the same "re-read fresh state" rule the call dispatchers follow.
 */
export async function handleWorkflowRun(
  job: WorkflowRunJob,
  /**
   * Needed ONLY to re-deliver a run that parks at a `logic.wait`.
   *
   * Optional so every existing caller and test compiles unchanged — but a run
   * that parks without it would never wake, so the absence is reported rather
   * than ignored (see the outcome below).
   */
  boss?: PgBoss,
): Promise<RunWorkflowOutcome | { status: 'skipped'; reason: string }> {
  const run = await loadRunForExecution(job.runId);
  if (!run) return { status: 'skipped', reason: 'run_not_found' };

  // A run that already reached a terminal state is not re-executed. The step
  // ledger would short-circuit every node anyway, but stopping here means a
  // redelivered job does not rewrite the run's status and finished_at.
  //
  // 'waiting' IS re-executable, and must be: it is how a parked run comes back.
  // The step ledger is what decides whether the wait has actually elapsed — this
  // gate only says the run is still in flight.
  if (run.status !== 'pending' && run.status !== 'running' && run.status !== 'waiting') {
    return { status: 'skipped', reason: `already_${run.status}` };
  }

  // ⚠️ WHICH DEFINITION THIS RUN EXECUTES, and why it depends on the status.
  //
  // A run that has PARKED at `logic.wait` may have been asleep for days. Waking
  // it on the workflow as it stands today means an owner who edited the diagram
  // in the meantime silently changed a run already in flight: finished steps are
  // safe (the ledger replays them by node id and repeats no side effect), but a
  // node ADDED BEFORE the wait has no ledger row, so it reads as unreached and
  // EXECUTES on resume. Nobody drawing a new step expects it to fire for someone
  // who was messaged last Tuesday.
  //
  // Everything else keeps reading fresh, which the doc comment above calls out as
  // deliberate and matches the call dispatchers: an edit between enqueue and a
  // prompt execution SHOULD be picked up. The bug was never freshness — it was
  // time, and only a wait turns "moments" into "days".
  //
  // `?? run.storedDefinition` is the pre-column fallback: a run created before
  // the snapshot existed has none, and must behave exactly as it did before.
  const definition =
    run.status === 'waiting' ? (run.definitionSnapshot ?? run.storedDefinition) : run.storedDefinition;

  const outcome = await runWorkflow({
    runId: run.runId,
    workflowId: run.workflowId,
    storedDefinition: definition,
    trigger: run.triggerPayload as unknown as WorkflowTriggerPayload,
    // The server-injected bag, resolved HERE because `getAppOrigin` is
    // `server-only` and the engine deliberately is not — see
    // `RunWorkflowArgs.variables`.
    //
    // `app_url` is the one value that must not come from the builder. It is the
    // origin every shareable KALFA link is built on, validated from the
    // APP_ORIGIN server var and never from a request header, so a workflow can
    // put a link in a guest's message without an owner typing a URL that a typo
    // or a paste could redirect.
    variables: { app_url: await getAppOrigin() },
    deps: {
      ledger: createStepLedger(),
      runs: createRunStore(),
      guests: createGuestActions(),
      alerts: createTeamAlerts(),
      webhook: createOutboundWebhook(),
      // Only the real path logs. A dry run passes no log and returns its trace
      // directly — nothing to stream, and nothing to write.
      log: createExecutionLog(),
    },
  });

  if (outcome.status === 'waiting') {
    if (!boss) {
      // Fail LOUDLY rather than leaving a row that sleeps for ever. The run is
      // already parked in the database; what is missing is the alarm clock, and
      // a silent return would make that indistinguishable from a wait in
      // progress.
      throw new Error(
        `workflow run ${job.runId} parked until ${outcome.resumeAt} but no queue handle was available to reschedule it`,
      );
    }
    await enqueueWorkflowRun(boss, job.runId, new Date(outcome.resumeAt));
  }

  return outcome;
}

/**
 * Re-deliver parked runs whose wake-up never arrived.
 *
 * ⚠️ EXTRACTED FROM THE WORKER SO THE `resumeAt` CAN BE TESTED. A fault
 * injection on 2026-09-14 dropped it from the call and nothing failed: `tsc`
 * accepts it (the parameter is optional) and no test reached worker/main.ts.
 * Without it the rescue is not merely weaker — it is a NO-OP, and a silent one.
 *
 * The deadline is folded into the pg-boss job id, so passing it rebuilds the
 * EXACT id the lost wake-up carried, and pg-boss inserts with
 * `ON CONFLICT DO NOTHING` (its own 12.30.0 source). That makes the rescue
 * idempotent in both directions: a job still queued swallows the insert, a job
 * genuinely gone lets it through. Omitting it instead reuses the FIRST
 * delivery's id — long since completed — and the insert is dropped, leaving the
 * run parked for ever with a sweep that appears to be running.
 */
export async function redeliverStuckWaitingRuns(
  boss: PgBoss,
  list: () => Promise<{ runId: string; resumeAt: string }[]> = listStuckWaitingRuns,
): Promise<number> {
  const stuck = await list();
  for (const { runId, resumeAt } of stuck) {
    console.warn(`[workflow] parked run ${runId} missed its wake-up — re-delivering`);
    await enqueueWorkflowRun(boss, runId, new Date(resumeAt));
  }
  return stuck.length;
}
