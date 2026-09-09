// The wire shape of the execution stream, shared by the SSE route and the client.
//
// Mirrors the vendored `ExecutionEvent` / `ExecutionSnapshot` in
// vendor/workflowbuilder/types/workflow-execution/execution-events.ts, narrowed
// to what our runner actually emits and to the fields the canvas reads. Kept
// here rather than imported from the vendor directory so the client bundle does
// not reach into it — the vendored tree is the worker's half, and the rule is
// that nothing outside src/lib/workflow imports from it.
import type { ExecutionStatus } from './vendor/workflowbuilder/types/workflow-execution/execution-events';

export type StreamEvent = {
  seq: number;
  type: string;
  nodeId?: string;
  payload?: unknown;
  timestamp: string;
};

export type StreamSnapshot = {
  runId: string;
  status: ExecutionStatus;
  lastSequence: number;
  events: StreamEvent[];
};

export type { ExecutionStatus };

// The four the vendored TERMINAL_EXECUTION_STATUSES tuple declares. Duplicated
// as a plain set rather than imported, for the bundle reason above; the
// migration's check constraint is the third copy and the comment in each names
// the others.
const TERMINAL_STATUSES = new Set(['completed', 'incomplete', 'failed', 'cancelled']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

const TERMINAL_EVENT_TYPES = new Set([
  'execution_completed',
  'execution_incomplete',
  'execution_failed',
  'execution_cancelled',
]);

export function isTerminalEventType(type: string): boolean {
  return TERMINAL_EVENT_TYPES.has(type);
}
