// One run, end to end: stored diagram → conversion → runGraph → terminal status.
//
// Called by the worker with the real dependencies wired, and by the tests with
// fakes. It owns no I/O of its own — every write goes through the ports — so the
// whole execution path is exercisable without a database.
import { toWorkflowDefinition, type KalfaNode } from '../adapter/to-definition';
import { WORKFLOW_WAIT_CODE, type WorkflowTriggerPayload } from '../steps';
import { runGraph } from '../vendor/workflowbuilder/execution-core/graph-runner';
import type { EventEmitterPort } from '../vendor/workflowbuilder/execution-core/ports/event-emitter.port';

import { createActivityRunner, type CapturedWait } from './activity-runner';
import { RUN_ABANDONED_CODE, STEP_IN_FLIGHT_CODE } from './ports';
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
  /**
   * The queue's "this job is no longer yours" signal, when there is a queue.
   *
   * pg-boss aborts `job.signal` when the batch ends — including when the handler
   * outlived `expireInSeconds` and the run has already been given to a retry.
   * Passed straight through to the activity runner, which checks it before every
   * claim. See `ActivityRunnerArgs.signal`.
   */
  signal?: AbortSignal;
  deps: WorkflowEngineDeps;
};

export type RunWorkflowOutcome =
  | { status: 'completed' }
  | { status: 'incomplete'; deadEnds: { nodeId: string; port: string }[] }
  /**
   * Parked at a `logic.wait`. NOT terminal — the caller must re-deliver the run
   * at `resumeAt`, and the row keeps no `finished_at`.
   */
  | {
      status: 'waiting';
      resumeAt: string;
      nodeId: string;
      correlationId?: string;
      /**
       * "Has it already happened?" — asked by the CALLER, and only after it has
       * registered the fallback wake-up. Never persisted and never queued: it is
       * a closure over the node's own domain and lives only between this call
       * and its caller, in one invocation.
       */
      verify?: () => Promise<boolean>;
    }
  /**
   * Another delivery of THIS SAME RUN holds the node right now.
   *
   * ⚠️ NOT A FAILURE, and it used to be recorded as one. Two jobs for one run is
   * a thing pg-boss allows — `singletonKey` constrains nothing under the
   * `standard` policy, and a job that outlives `expireInSeconds` is re-queued
   * while its handler is still running — so a retry meeting a live claim is
   * ordinary scheduling, not a broken workflow. Writing 'failed' for it ended
   * runs that were working perfectly.
   *
   * The run row is left EXACTLY as it was: no status write at all. The winner
   * owns the run's state, and a loser that stamped 'running' would clear
   * `resume_at` and `resume_correlation_id` out from under a park the winner is
   * about to write.
   */
  | { status: 'contended'; nodeId: string; reason: 'in_flight' | 'abandoned' }
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

  // THE PARK, CAPTURED WHERE IT IS STILL STRUCTURED.
  //
  // The vendored runner flattens a throw to `{message, code, attempt}` before it
  // emits `node_failed` (graph-runner.ts, via extractDeepestError), so by the
  // time the event is observed the wait's own fields are gone. That is why the
  // deadline used to be recovered with a regex over the error message — and why
  // adding a correlation the same way would have meant a second, more brittle
  // one.
  //
  // The runner's `onWait` is where the park is seen WHOLE — deadline,
  // correlation, and the ephemeral `verify` closure — immediately after the row
  // is durable and before the error is rethrown. It replaced a wrapper around
  // `beginWait`, which could only ever see the durable half, because `beginWait`
  // is a persistence contract and a closure has no row to live in.
  //
  // Nothing under `vendor/` is modified, and nothing is parsed.
  let parked: CapturedWait | null = null;

  const runner = createActivityRunner<KalfaNode>({
    runId,
    workflowId,
    trigger,
    ledger: deps.ledger,
    guests: deps.guests,
    alerts: deps.alerts,
    webhook: deps.webhook,
    ...(args.signal ? { signal: args.signal } : {}),
    onWait: (wait) => {
      parked = wait;
    },
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
  let waitRequest: {
    resumeAt: string;
    nodeId: string;
    correlationId?: string;
    verify?: () => Promise<boolean>;
  } | null = null;
  let contendedNodeId: { nodeId: string; reason: 'in_flight' | 'abandoned' } | null = null;

  const events: EventEmitterPort = {
    emitEvent: async (executionId, type, payload, nodeId) => {
      // The EVENT only says a wait happened; the VALUES come from the capture
      // above, which saw them structured. `parked` is always set by the time
      // this fires — activity-runner calls `beginWait` immediately before it
      // rethrows, and refuses the node when the ledger cannot park — but it is
      // read defensively rather than asserted, because losing a park to a crash
      // here would be worse than a run that simply does not wait.
      // Contention, intercepted the same way a wait is and for a closely related
      // reason: the runner reports both as `node_failed` because throwing is the
      // only way a node can stop the graph, and neither is a failure of the
      // workflow. Suppressed here so an owner's log does not show a red step for
      // a run that is simply being retried.
      const contention = type === 'node_failed' ? contentionReason(payload) : null;
      if (contention && nodeId) {
        contendedNodeId = { nodeId, reason: contention };
        return;
      }
      if (contendedNodeId && type === 'execution_failed') return;

      const wait = type === 'node_failed' && isWaitFailure(payload) ? parked : null;
      if (wait && nodeId) {
        waitRequest = {
          resumeAt: wait.resumeAt,
          nodeId,
          ...(wait.correlationId ? { correlationId: wait.correlationId } : {}),
          ...(wait.verify ? { verify: wait.verify } : {}),
        };
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
      // The run is being worked on by another delivery. Nothing about its state
      // is this attempt's to write — see the 'contended' outcome.
      //
      // ⚠️ THE 'running' FROM `execution_started` HAS ALREADY LANDED by the time
      // this can fire, because the runner emits it before any node is claimed.
      // That write clears `resume_at` and `resume_correlation_id` (store.ts, and
      // deliberately so — a stale deadline would be re-delivered for ever), so a
      // losing delivery of a PARKED run can strip the correlation the winner is
      // about to re-park with. The consequence is bounded and not silent: the
      // wake RPC matches on that correlation, finds none, and reports no wake —
      // the run then falls back to its `resume_at` ceiling instead of being woken
      // early. Fixing it properly means knowing the loser before the first
      // status write, which the runner's event order does not allow.
      if (contendedNodeId) return;
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
    const { resumeAt, nodeId, correlationId, verify } = waitRequest;
    await deps.runs.setRunStatus({
      runId,
      status: 'waiting',
      resumeAt,
      ...(correlationId ? { resumeCorrelationId: correlationId } : {}),
    });
    // ⚠️ `verify` IS HANDED OUT, NOT CALLED HERE. The park is durable now, but
    // the fallback wake-up is not registered until the caller enqueues the
    // delayed job — and asking "already happened?" before that leaves the very
    // window it exists to close: a callback landing in between would find a
    // waiting run with no job to pull forward, answer 200, and the run would
    // sleep to its ceiling. REGISTER, then CHECK.
    return {
      status: 'waiting',
      resumeAt,
      nodeId,
      ...(correlationId ? { correlationId } : {}),
      ...(verify ? { verify } : {}),
    };
  }

  // AFTER the wait branch: a park is a definite outcome for this delivery, and a
  // graph that parked did not also lose a race. Checked before the failure branch
  // for the same reason the wait is — the runner reported both as failures.
  if (contendedNodeId) {
    // Destructured rather than spread: `contendedNodeId` is only ever assigned
    // inside the event callback, so TypeScript cannot narrow it here and a
    // spread of the un-narrowed type does not compile. Same shape as the wait
    // branch above, for the same reason.
    const { nodeId, reason } = contendedNodeId;
    return { status: 'contended', nodeId, reason };
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
 * Whether a `node_failed` payload is a park rather than a failure.
 *
 * The CODE is all this reads, and all it can read. The payload has been rebuilt
 * by `runNode` into `{ error: { message, code, attempt } }` (graph-runner.ts,
 * via `extractDeepestError`), so the thrown object — and every field the wait
 * put on it — is gone by the time this sees anything.
 *
 * It used to recover the deadline with a regex over the message, for exactly
 * that reason. It no longer does: `beginWait` is wrapped where the park is still
 * structured, so the values come from there and the event is left with the one
 * job it can still do reliably. Adding a correlation the old way would have
 * meant a second and more brittle pattern; this removed the first instead.
 *
 * `node_failed` is emitted from exactly ONE place in the vendored runner
 * (graph-runner.ts:321, inside the catch around `executeNode`), and every wait
 * therefore passes through activity-runner's own catch, which calls `beginWait`
 * before it rethrows and refuses the node outright when the ledger cannot park.
 * That is what makes the capture complete rather than best-effort.
 */
function isWaitFailure(payload: unknown): boolean {
  const error = (payload as { error?: { code?: unknown } } | undefined)?.error;
  return error?.code === WORKFLOW_WAIT_CODE;
}

/**
 * Whether a `node_failed` payload is a lost race rather than a failure.
 *
 * Reads the code and nothing else, exactly like `isWaitFailure` and for the same
 * reason: `runNode` has already rebuilt the payload into
 * `{ error: { message, code, attempt } }`, so the thrown object is gone. The code
 * is shared with the raiser through `STEP_IN_FLIGHT_CODE` rather than repeated
 * as a literal — a rename on one side used to turn every contention silently
 * back into a failed run.
 */
function contentionReason(payload: unknown): 'in_flight' | 'abandoned' | null {
  const error = (payload as { error?: { code?: unknown } } | undefined)?.error;
  if (error?.code === STEP_IN_FLIGHT_CODE) return 'in_flight';
  if (error?.code === RUN_ABANDONED_CODE) return 'abandoned';
  return null;
}
