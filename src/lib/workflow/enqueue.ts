// Enqueue one workflow run, and execute one.
//
// Kept free of `server-only` so the worker can bundle it; the Supabase access it
// needs arrives through the store, which is server-only and imported by the
// worker process (not by the browser).
import type { PgBoss } from 'pg-boss';

import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES, WORKFLOW_RETRY, type WorkflowRunJob } from '@/lib/queue/queues';

import { runWorkflow, type RunWorkflowOutcome } from './engine/run-workflow';
import { createGuestActions } from './guest-actions';
import type { WorkflowTriggerPayload } from './steps';
import { createExecutionLog, createRunStore, createStepLedger, loadRunForExecution } from './store';

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
export async function enqueueWorkflowRun(boss: PgBoss, runId: string): Promise<void> {
  const data: WorkflowRunJob = { runId };
  await boss.send(QUEUES.workflowRun, data, {
    id: deterministicJobId(`workflow-run:${runId}`),
    singletonKey: runId,
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
): Promise<RunWorkflowOutcome | { status: 'skipped'; reason: string }> {
  const run = await loadRunForExecution(job.runId);
  if (!run) return { status: 'skipped', reason: 'run_not_found' };

  // A run that already reached a terminal state is not re-executed. The step
  // ledger would short-circuit every node anyway, but stopping here means a
  // redelivered job does not rewrite the run's status and finished_at.
  if (run.status !== 'pending' && run.status !== 'running') {
    return { status: 'skipped', reason: `already_${run.status}` };
  }

  return runWorkflow({
    runId: run.runId,
    workflowId: run.workflowId,
    storedDefinition: run.storedDefinition,
    trigger: run.triggerPayload as unknown as WorkflowTriggerPayload,
    deps: {
      ledger: createStepLedger(),
      runs: createRunStore(),
      guests: createGuestActions(),
      // Only the real path logs. A dry run passes no log and returns its trace
      // directly — nothing to stream, and nothing to write.
      log: createExecutionLog(),
    },
  });
}
