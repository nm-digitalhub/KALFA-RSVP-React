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

export type NodeExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'skipped';

export type NodeExecutionState = {
  status: NodeExecutionStatus;
  output?: unknown;
  error?: { message: string; code?: string };
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
  }

  return events;
}

function applyEventToNodeStates(
  event: StreamEvent,
  states: Record<string, NodeExecutionState>,
) {
  if (!event.nodeId) return;
  const payload = event.payload as
    | { output?: unknown; error?: { message: string; code?: string } }
    | undefined;

  switch (event.type) {
    case 'node_started': {
      states[event.nodeId] = { status: 'running' };
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
