// One run, end to end: stored diagram → conversion → runGraph → terminal status.
//
// Called by the worker with the real dependencies wired, and by the tests with
// fakes. It owns no I/O of its own — every write goes through the ports — so the
// whole execution path is exercisable without a database.
import { toWorkflowDefinition, type KalfaNode } from '../adapter/to-definition';
import { WORKFLOW_WAIT_CODE, type WorkflowTriggerPayload } from '../steps';
import { runGraph } from '../vendor/workflowbuilder/execution-core/graph-runner';
import type { EventEmitterPort } from '../vendor/workflowbuilder/execution-core/ports/event-emitter.port';

import { createActivityRunner } from './activity-runner';
import type { RunStatus, WorkflowEngineDeps } from './ports';

export type RunWorkflowArgs = {
  runId: string;
  workflowId: string;
  /** `workflows.definition` exactly as stored. Parsed and validated by the adapter. */
  storedDefinition: unknown;
  trigger: WorkflowTriggerPayload;
  /**
   * The SERVER-side bag, reachable from a node config as `{{variables.<name>}}`.
   *
   * Passed IN rather than computed here, and that is the whole design. The only
   * value worth putting in it today is the app's canonical origin, which lives
   * behind `getAppOrigin()` in a `server-only` module — importing that here
   * would drag `server-only`, a file read and a Supabase client into the module
   * the worker bundles and every engine test imports. That mistake was made once
   * already this session with the Slack alert, and the whole suite failed at
   * import. So the caller supplies it: `enqueue.ts` on the live path, the dry run
   * on the test path.
   *
   * WHY THIS BAG EXISTS AT ALL, given `global` already does. Trust. `global` is
   * whatever an owner typed into the variables panel — forgeable by anyone who
   * can edit the diagram. `variables` is injected by the server and an owner
   * cannot reach it. Anything a message must not get wrong belongs here: with
   * this empty, an owner wanting to link to the site had to type the URL into a
   * global, so a typo or a paste silently changed where guests were sent.
   */
  variables?: Record<string, unknown>;
  deps: WorkflowEngineDeps;
};

export type RunWorkflowOutcome =
  | { status: 'completed' }
  | { status: 'incomplete'; deadEnds: { nodeId: string; port: string }[] }
  /**
   * Parked at a `logic.wait`. NOT terminal — the caller must re-deliver the run
   * at `resumeAt`, and the row keeps no `finished_at`.
   */
  | { status: 'waiting'; resumeAt: string; nodeId: string }
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
    workflowId,
    trigger,
    ledger: deps.ledger,
    guests: deps.guests,
    alerts: deps.alerts,
    webhook: deps.webhook,
  });

  // The runner's own event stream, appended to the execution log when one is
  // wired (the dry run passes none — it returns its trace directly).
  //
  // Every write here is fail-soft. An event is a record of something that
  // already happened; losing one costs a line in a replay, while throwing would
  // abort a run whose side effects have landed. The vendored runner takes the
  // same position on its own `node_skipped` emit, and for the same reason.
  // The name the owner typed on each node, by id.
  //
  // Built here because this is the last place that holds BOTH the definition and
  // the event stream. The vendored runner deals only in ids — correctly, since it
  // knows nothing about our vocabulary — so a log fed straight from it names every
  // step by a uuid the owner has never seen. `label` is already on `BaseNode`,
  // lifted out of the properties by the adapter, so nothing about the execution
  // contract has to change to read it.
  const labelById = new Map(
    converted.definition.nodes.flatMap((node) =>
      node.label === undefined ? [] : [[node.id, node.label] as const],
    ),
  );

  // Attach the label to the event's own payload rather than to a column.
  //
  // The payload is jsonb and already carries per-event detail, so this needs no
  // migration and no change to rows already written — an old run simply has no
  // label and the panel falls back to the id, which is what it showed before.
  //
  // `execution_incomplete` gets the same treatment one level down: its payload is
  // a list of dead ends, and that list produces the single most useful line in
  // the whole log — "this step routed somewhere and nothing is wired to it". It
  // was the line most in need of a name.
  function withLabels(type: string, payload: unknown, nodeId?: string): unknown {
    const label = nodeId === undefined ? undefined : labelById.get(nodeId);

    if (type === 'execution_incomplete') {
      const deadEnds = (payload as { deadEnds?: { nodeId: string; port: string }[] } | undefined)
        ?.deadEnds;
      if (Array.isArray(deadEnds)) {
        return {
          ...(payload as object),
          deadEnds: deadEnds.map((end) => ({
            ...end,
            ...(labelById.has(end.nodeId) ? { nodeLabel: labelById.get(end.nodeId) } : {}),
          })),
        };
      }
    }

    if (label === undefined) return payload;
    return payload === undefined || payload === null || typeof payload !== 'object'
      ? { nodeLabel: label, ...(payload === undefined ? {} : { value: payload }) }
      : { ...(payload as object), nodeLabel: label };
  }

  // ⚠️ THE WAIT INTERCEPT, and the reason it lives in this wrapper rather than
  // in the vendored runner.
  //
  // `runGraph` has no suspension point (read in full 2026-09-13), so a wait
  // travels as a thrown error: the node throws, `runNode` catches it, the
  // default 'fail' policy makes it fatal, and `failExecution` returns
  // `{ status: 'failed', error: { code } }` with the code intact. That is the
  // only channel out of the scheduler — and it is enough, because the code
  // identifies it unambiguously.
  //
  // What must NOT survive is the paperwork. Left alone the runner emits
  // `node_failed` + `execution_failed` and writes the run as FAILED, so an owner
  // opening the log would read that their automation broke when it is simply
  // waiting. Those are suppressed here and a `node_waiting` is emitted instead —
  // an event the vendored model already declares and never emitted, now carrying
  // the one thing worth knowing: when it wakes.
  //
  // Nothing under `vendor/` is modified. The interception is entirely inside the
  // two callbacks this file already owns.
  let waitRequest: { resumeAt: string; nodeId: string } | null = null;

  const events: EventEmitterPort = {
    emitEvent: async (executionId, type, payload, nodeId) => {
      const wait = type === 'node_failed' ? readWaitCode(payload) : null;
      if (wait && nodeId) {
        waitRequest = { resumeAt: wait.resumeAt, nodeId };
        if (deps.log) {
          try {
            await deps.log.appendEvent({
              runId: executionId,
              type: 'node_waiting',
              nodeId,
              // `resumeAt` extends the declared payload deliberately: the log
              // panel is ours, and "waiting" without "until when" is not useful.
              payload: withLabels('node_waiting', { resumeAt: wait.resumeAt }, nodeId),
            });
          } catch {
            // Same fail-soft rule as every other event here.
          }
        }
        return;
      }

      // The terminal failure the runner raises FOR the wait. Suppressed: the run
      // has not failed, and `execution_failed` must not be the last line of a log
      // that continues in three days.
      if (waitRequest && type === 'execution_failed') return;

      if (!deps.log) return;
      try {
        await deps.log.appendEvent({
          runId: executionId,
          type,
          ...(nodeId ? { nodeId } : {}),
          payload: withLabels(type, payload, nodeId),
        });
      } catch {
        // Deliberately swallowed — see above.
      }
    },
    updateStatus: async (executionId, status, errorMessage) => {
      // The run is parked, not failed. The park itself is written after
      // `runGraph` returns, because the deadline cannot travel through this
      // callback's signature.
      if (waitRequest && status === 'failed') return;
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
      // `variables` is the SERVER-side bag in the vendored `ExecutionContext`,
      // injected by the backend and unreachable from the builder. See
      // `RunWorkflowArgs.variables` for why it is passed in rather than built
      // here, and why it is not the same thing as `global` below.
      //
      // `run_id` and `workflow_id` are added rather than taken from the caller:
      // this function already knows them, and a caller free to supply its own
      // could put a different run's id in a team alert. They are also the two
      // values that make an alert traceable back to the run that raised it.
      variables: {
        ...args.variables,
        run_id: runId,
        workflow_id: workflowId,
      },
      // `global` is the other one: "global variables defined manually in the
      // builder" — whatever the owner typed into the variables panel. It was
      // `{}` while that panel was happily accepting definitions and persisting
      // them, which made this input factually wrong about the diagram it came
      // from.
      //
      // Both bags are live: `resolve-template.ts` is vendored, imported by
      // `activity-runner.ts`, and runs over every field of every node config
      // before its handler sees it. All four namespaces resolve —
      // `{{trigger.…}}`, `{{nodes.<id>.…}}`, `{{global.…}}` and
      // `{{variables.…}}` — with `?` for safe navigation and
      // `| default:'…'` for a fallback.
      global: converted.globals,
    },
    runner,
    events,
  );

  // BEFORE the failure branch, because the runner reported this run as failed —
  // that is how a wait leaves the scheduler at all.
  if (waitRequest) {
    const { resumeAt, nodeId } = waitRequest;
    await deps.runs.setRunStatus({ runId, status: 'waiting', resumeAt });
    return { status: 'waiting', resumeAt, nodeId };
  }

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
  'waiting',
  'cancelling',
  'completed',
  'incomplete',
  'failed',
  'cancelled',
]);

function isRunStatus(value: string): value is RunStatus {
  return RUN_STATUSES.has(value);
}

/**
 * The wait deadline inside a `node_failed` payload, or null.
 *
 * ⚠️ READ OUT OF THE MESSAGE, and that is not laziness. The payload has already
 * crossed `withRedactedPayloads` and been rebuilt by `runNode` into
 * `{ error: { message, code } }` — the thrown object, and with it the
 * `resumeAt` field, is gone by the time this wrapper sees anything. The message
 * is the only carrier left, which is why `WorkflowWaitSignal` composes an ISO
 * timestamp into it rather than relying on a property surviving.
 *
 * The code is still what IDENTIFIES a wait; the timestamp is only extracted once
 * the code has already matched, so an ordinary failure whose message happens to
 * contain a date is never read as one.
 */
function readWaitCode(payload: unknown): { resumeAt: string } | null {
  const error = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  if (!error || error.code !== WORKFLOW_WAIT_CODE) return null;
  if (typeof error.message !== 'string') return null;
  const match = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(error.message);
  return match ? { resumeAt: match[1]! } : null;
}
