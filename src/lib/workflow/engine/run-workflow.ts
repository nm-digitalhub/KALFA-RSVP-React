// One run, end to end: stored diagram → conversion → runGraph → terminal status.
//
// Called by the worker with the real dependencies wired, and by the tests with
// fakes. It owns no I/O of its own — every write goes through the ports — so the
// whole execution path is exercisable without a database.
import { toWorkflowDefinition, type KalfaNode } from '../adapter/to-definition';
import type { WorkflowTriggerPayload } from '../steps';
import { runGraph } from '../vendor/workflowbuilder/execution-core/graph-runner';
import type { EventEmitterPort } from '../vendor/workflowbuilder/execution-core/ports/event-emitter.port';

import { createActivityRunner } from './activity-runner';
import type { WorkflowEngineDeps } from './ports';

export type RunWorkflowArgs = {
  runId: string;
  workflowId: string;
  /** `workflows.definition` exactly as stored. Parsed and validated by the adapter. */
  storedDefinition: unknown;
  trigger: WorkflowTriggerPayload;
  deps: WorkflowEngineDeps;
};

export type RunWorkflowOutcome =
  | { status: 'completed' }
  | { status: 'incomplete'; deadEnds: { nodeId: string; port: string }[] }
  | { status: 'failed'; message: string };

export async function runWorkflow(args: RunWorkflowArgs): Promise<RunWorkflowOutcome> {
  const { runId, workflowId, storedDefinition, trigger, deps } = args;

  // Conversion first, and it is allowed to end the run. A graph that fails the
  // contract never reaches `runGraph`, so no node executes and no side effect
  // happens — that is test 10, and it is why validation lives in the adapter
  // rather than relying on the runner's own `resolveStartNode`, which would
  // already have emitted `execution_started`.
  const converted = toWorkflowDefinition(workflowId, storedDefinition);
  if (!converted.ok) {
    const message = converted.errors.map((e) => e.message).join(' ');
    await deps.runs.setRunStatus({ runId, status: 'failed', errorMessage: message });
    return { status: 'failed', message };
  }

  await deps.runs.setRunStatus({ runId, status: 'running' });

  const runner = createActivityRunner<KalfaNode>({
    runId,
    trigger,
    ledger: deps.ledger,
    guests: deps.guests,
    alerts: deps.alerts,
  });

  // The runner's own event stream, appended to the execution log when one is
  // wired (the dry run passes none — it returns its trace directly).
  //
  // Every write here is fail-soft. An event is a record of something that
  // already happened; losing one costs a line in a replay, while throwing would
  // abort a run whose side effects have landed. The vendored runner takes the
  // same position on its own `node_skipped` emit, and for the same reason.
  const events: EventEmitterPort = {
    emitEvent: async (executionId, type, payload, nodeId) => {
      if (!deps.log) return;
      try {
        await deps.log.appendEvent({
          runId: executionId,
          type,
          ...(nodeId ? { nodeId } : {}),
          payload,
        });
      } catch {
        // Deliberately swallowed — see above.
      }
    },
    updateStatus: async (executionId, status, errorMessage) => {
      if (!isRunStatus(status)) return;
      await deps.runs.setRunStatus({
        runId: executionId,
        status,
        ...(errorMessage ? { errorMessage } : {}),
      });
    },
  };

  const outcome = await runGraph(
    {
      workflowId,
      // The run id IS the execution id, so `updateStatus` addresses the right
      // row without a second mapping to keep in sync.
      executionId: runId,
      definition: converted.definition,
      triggerPayload: { ...trigger },
      // `variables` is the SERVER-side secrets bag in the vendored
      // `ExecutionContext`, injected by the backend. KALFA injects none, so it
      // stays empty — not an oversight, a different bag.
      variables: {},
      // `global` is the other one: "global variables defined manually in the
      // builder". It was `{}` while the editor's variables panel was happily
      // accepting definitions and persisting them, which made this input
      // factually wrong about the diagram it came from.
      //
      // Filling it does not yet make the panel USABLE: reading a global from a
      // node config needs `{{global.x}}`, and `resolve-template.ts` is
      // deliberately not vendored, so the adapter still blocks that syntax.
      // What it does is make the runner's input honest, so the resolver — when
      // it lands — has nothing left to wire on this side.
      global: converted.globals,
    },
    runner,
    events,
  );

  if (outcome.status === 'failed') {
    return { status: 'failed', message: outcome.error.message };
  }
  if (outcome.status === 'incomplete') {
    return { status: 'incomplete', deadEnds: outcome.deadEnds };
  }
  return { status: 'completed' };
}

// `EventEmitterPort.updateStatus` takes a bare string; workflow_runs.status has
// a check constraint. Narrowing here means an unrecognised status is dropped
// rather than sent to Postgres to be rejected mid-run.
const RUN_STATUSES = new Set([
  'pending',
  'running',
  'cancelling',
  'completed',
  'incomplete',
  'failed',
  'cancelled',
]);

function isRunStatus(
  value: string,
): value is 'pending' | 'running' | 'cancelling' | 'completed' | 'incomplete' | 'failed' | 'cancelled' {
  return RUN_STATUSES.has(value);
}
