'use client';

// Ported from the reference app's stores/use-execution-store.ts, same shape and
// same reducer semantics. Two deliberate differences, both forced by where it
// runs rather than by taste:
//
//   * No `persist` to sessionStorage. The reference app persists only the log's
//     collapsed flag; here the panel lives inside an admin route whose state is
//     already per-visit, and a persisted key would outlive the workflow it
//     described.
//   * No `devtools`. It is a dev-only wrapper the reference app leaves on; this
//     ships to an admin in production.
import { create } from 'zustand';

import type { StreamEvent, StreamSnapshot } from '@/lib/workflow/execution-events';

/**
 * ⚠️ `'waiting'` PROJECTS AN EVENT UPSTREAM DECLARES AND DOES NOT EMIT.
 *
 * Upstream declares `node_waiting` in its execution-event contract — a member of
 * `ExecutionEventType` with its own `NodeWaitingEvent` type, verified against
 * `synergycodes/workflowbuilder@4ee63c4` and byte-identical to the copy under
 * `vendor/` — but its reference runner currently does not emit it, and its
 * reference client does not project it. `runGraph` has eight `emitEvent` calls
 * and none is this one.
 *
 * KALFA emits it, for `logic.wait`. So KALFA must also project it. This union
 * was ported from that reference client, which is why it arrived without the
 * state: the engine wrote the event, the stream carried it, and the reducer
 * dropped it — leaving a parked node showing `running`, spinner and all, for as
 * long as it was parked. `logic.wait` allows a year of that.
 */
export type NodeExecutionStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'skipped';

export type NodeExecutionState = {
  status: NodeExecutionStatus;
  output?: unknown;
  error?: { message: string; code?: string };
  /**
   * When a parked node is due to wake, ISO-8601.
   *
   * ⚠️ NOT PART OF THE VENDOR'S PAYLOAD, and deliberately so at both ends. The
   * source declares `NodeWaitingPayload = { waitingForNodeIds?: string[] }` — a
   * JOIN node waiting for its predecessors. KALFA overloads the same event for a
   * `logic.wait` parked on a deadline, and `run-workflow.ts` attaches `resumeAt`
   * with the note that "waiting without until-when is not useful". It was right,
   * and until now nothing read it.
   */
  resumeAt?: string;
  /**
   * What the node is waiting ON, which is what decides how `resumeAt` reads.
   *
   *   'timer'  a `logic.wait` deadline. `resumeAt` is when it RESUMES.
   *   'event'  a correlated wait — a call outcome, a webhook. `resumeAt` is the
   *            TIMEOUT; the callback may land long before it, or never.
   *
   * ⚠️ WITHOUT THIS THE TWO ARE INDISTINGUISHABLE, and the canvas said
   * "continues at 14:30" about a node really waiting for a phone call to end.
   * The vendor's own execution-visualisation guidance asks for exactly this —
   * "a waiting node shows what it is waiting on — an event, a human, a delay".
   */
  waitKind?: 'timer' | 'event';
};

type ExecutionStore = {
  runId: string | undefined;
  status: string;
  nodeStates: Record<string, NodeExecutionState>;
  events: StreamEvent[];
  isLogCollapsed: boolean;
};

type DryRunOutcome =
  | { status: 'completed' }
  | { status: 'incomplete'; deadEnds: { nodeId: string; port: string }[] }
  /**
   * The run reached a `logic.wait` and parked. In a DRY run nothing is actually
   * scheduled — the trace simply ends here, which is the honest answer to "what
   * would this do": it would get this far and then wait.
   */
  | { status: 'waiting'; resumeAt: string; nodeId: string }
  /**
   * Present only because this type is fed from `RunWorkflowOutcome`, which a live
   * run shares. A DRY run cannot reach it: `contended` means a second delivery of
   * the same run holds a node, and a dry run is single-threaded, never queued and
   * never retried — dry-run.ts says the same about `in_flight`. Carried so the
   * canvas compiles against the full union rather than through a cast that would
   * also hide a real one.
   */
  | { status: 'contended'; nodeId: string }
  | { status: 'failed'; message: string };

const emptyStore: ExecutionStore = {
  runId: undefined,
  status: 'idle',
  nodeStates: {},
  events: [],
  isLogCollapsed: false,
};

export const useExecutionStore = create<ExecutionStore>()(() => ({ ...emptyStore }));

export function resetExecution() {
  useExecutionStore.setState((state) => ({
    ...emptyStore,
    isLogCollapsed: state.isLogCollapsed,
  }));
}

export function setExecutionStarted(runId: string) {
  useExecutionStore.setState({
    runId,
    status: 'pending',
    nodeStates: {},
    events: [],
    isLogCollapsed: false,
  });
}

export function applyConnectionLost() {
  useExecutionStore.setState({ status: 'disconnected' });
}

export function applySnapshot(snapshot: StreamSnapshot) {
  const nodeStates: Record<string, NodeExecutionState> = {};
  for (const event of snapshot.events) applyEventToNodeStates(event, nodeStates);

  useExecutionStore.setState({
    runId: snapshot.runId,
    status: snapshot.status,
    nodeStates,
    events: snapshot.events,
  });
}

export function applyEvent(event: StreamEvent) {
  useExecutionStore.setState((state) => {
    const nodeStates = { ...state.nodeStates };
    applyEventToNodeStates(event, nodeStates);
    return {
      nodeStates,
      events: [...state.events, event],
      status: eventToExecutionStatus(event) ?? state.status,
    };
  });
}

/**
 * Apply a dry run's trace as if it had arrived over the stream.
 *
 * A dry run produces the same per-node facts but returns them in one response
 * instead of streaming them, so this is the seam where the two paths converge:
 * everything downstream — highlighting, markers, the log — reads one store and
 * cannot tell which produced it.
 */
export function applyDryRunTrace(args: {
  outcome: DryRunOutcome;
  steps: { nodeId: string; status: 'completed' | 'failed'; output?: unknown; errorMessage?: string }[];
  skippedNodeIds: string[];
}) {
  const nodeStates: Record<string, NodeExecutionState> = {};
  for (const step of args.steps) {
    nodeStates[step.nodeId] =
      step.status === 'completed'
        ? { status: 'completed', output: step.output }
        : { status: 'failed', error: { message: step.errorMessage ?? '' } };
  }
  for (const nodeId of args.skippedNodeIds) {
    nodeStates[nodeId] ??= { status: 'skipped' };
  }

  // The node the trace stopped on, marked as parked rather than left idle.
  //
  // A dry run that reaches `logic.wait` ENDS there — nothing is scheduled — so
  // the node never produced a step and would otherwise carry no marker at all.
  // The canvas would show a trace that simply stops, with no indication of
  // which node stopped it. `contended` is the same shape for the same reason,
  // even though a dry run cannot reach it (see the union's own note).
  if (args.outcome.status === 'waiting') {
    nodeStates[args.outcome.nodeId] = {
      status: 'waiting',
      resumeAt: args.outcome.resumeAt,
    };
  } else if (args.outcome.status === 'contended') {
    nodeStates[args.outcome.nodeId] = { status: 'waiting' };
  }

  useExecutionStore.setState({
    runId: 'dry-run',
    status: args.outcome.status,
    nodeStates,
    events: buildDryRunEvents(args),
    isLogCollapsed: false,
  });
}

function buildDryRunEvents(args: {
  outcome: DryRunOutcome;
  steps: { nodeId: string; status: 'completed' | 'failed'; output?: unknown; errorMessage?: string }[];
  skippedNodeIds: string[];
}): StreamEvent[] {
  let seq = 1;
  const timestamp = new Date().toISOString();
  const events: StreamEvent[] = [
    { seq: seq++, type: 'execution_started', timestamp },
  ];

  for (const step of args.steps) {
    events.push({
      seq: seq++,
      type: 'node_started',
      nodeId: step.nodeId,
      timestamp,
    });
    events.push({
      seq: seq++,
      type: step.status === 'completed' ? 'node_completed' : 'node_failed',
      nodeId: step.nodeId,
      timestamp,
      payload:
        step.status === 'completed'
          ? { output: step.output }
          : { error: { message: step.errorMessage ?? 'הצעד נכשל בהרצת הבדיקה' } },
    });
  }

  for (const nodeId of args.skippedNodeIds) {
    events.push({
      seq: seq++,
      type: 'node_skipped',
      nodeId,
      timestamp,
      payload: { reason: 'branch_not_taken' },
    });
  }

  switch (args.outcome.status) {
    case 'completed':
      events.push({ seq: seq++, type: 'execution_completed', timestamp });
      break;
    case 'incomplete':
      events.push({
        seq: seq++,
        type: 'execution_incomplete',
        timestamp,
        payload: { deadEnds: args.outcome.deadEnds },
      });
      break;
    case 'failed':
      events.push({
        seq: seq++,
        type: 'execution_failed',
        timestamp,
        payload: { error: { message: args.outcome.message } },
      });
      break;
    // ⚠️ THE TWO NON-TERMINAL OUTCOMES, which this switch used to fall through
    // silently. `DryRunOutcome` has five members; three were handled, so a trace
    // that parked produced NO final line and the log just stopped — the reader
    // could not tell a parked run from a truncated one.
    //
    // Neither is a terminal event type, which is correct: nothing finished.
    case 'waiting':
      events.push({
        seq: seq++,
        type: 'node_waiting',
        nodeId: args.outcome.nodeId,
        timestamp,
        payload: { resumeAt: args.outcome.resumeAt },
      });
      break;
    case 'contended':
      events.push({
        seq: seq++,
        type: 'node_waiting',
        nodeId: args.outcome.nodeId,
        timestamp,
      });
      break;
  }

  return events;
}

function applyEventToNodeStates(
  event: StreamEvent,
  states: Record<string, NodeExecutionState>,
) {
  if (!event.nodeId) return;
  const payload = event.payload as
    | {
        output?: unknown;
        error?: { message: string; code?: string };
        resumeAt?: unknown;
        waitKind?: unknown;
      }
    | undefined;

  switch (event.type) {
    case 'node_started': {
      states[event.nodeId] = { status: 'running' };
      break;
    }
    case 'node_waiting': {
      // The node stays on the canvas as parked rather than running. `resumeAt`
      // is carried when the engine sent one — a vendored join-wait does not,
      // and a marker without a time is still truer than a spinner.
      states[event.nodeId] = {
        status: 'waiting',
        ...(typeof payload?.resumeAt === 'string' ? { resumeAt: payload.resumeAt } : {}),
        // Narrowed rather than cast: a row written before `waitKind` shipped
        // carries none, and reading a stray value as one of the two would make
        // an old parked run describe itself wrongly instead of vaguely.
        ...(payload?.waitKind === 'timer' || payload?.waitKind === 'event'
          ? { waitKind: payload.waitKind }
          : {}),
      };
      break;
    }
    case 'node_completed': {
      states[event.nodeId] = { status: 'completed', output: payload?.output };
      break;
    }
    case 'node_failed': {
      states[event.nodeId] = {
        status: 'failed',
        ...(payload?.error ? { error: payload.error } : {}),
      };
      break;
    }
    case 'node_skipped': {
      states[event.nodeId] = { status: 'skipped' };
      break;
    }
  }
}

export function setLogCollapsed(isLogCollapsed: boolean) {
  useExecutionStore.setState({ isLogCollapsed });
}

export function toggleLog() {
  setLogCollapsed(!useExecutionStore.getState().isLogCollapsed);
}

function eventToExecutionStatus(event: StreamEvent): string | undefined {
  switch (event.type) {
    case 'execution_started':
      return 'running';
    // ⚠️ A NODE EVENT THAT MOVES THE RUN'S STATUS, and it is the only one.
    //
    // There is no `execution_waiting`: the engine suppresses `execution_failed`
    // while parking (`run-workflow.ts` — "a run that parks has not failed") and
    // writes `waiting` straight to the row through `updateStatus`. So over a
    // LIVE stream `node_waiting` is the sole signal that the run parked, and
    // without this the header kept saying "רץ" until a reconnect brought a
    // snapshot. The snapshot path already reported it correctly, which is what
    // made the divergence easy to miss.
    case 'node_waiting':
      return 'waiting';
    case 'execution_completed':
      return 'completed';
    case 'execution_incomplete':
      return 'incomplete';
    case 'execution_failed':
      return 'failed';
    case 'execution_cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}
