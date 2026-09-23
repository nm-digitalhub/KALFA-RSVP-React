// How a run pauses: the signal a node throws to park, and the reader the
// engine uses to recognise it.
//
// ⚠️ SHARED ENGINE CODE, NOT `logic.wait`'S. Two node types park — `logic.wait`
// on a clock and `action.start_voice_call` on an external event — and the
// engine (`activity-runner`, `run-workflow`) reads the signal back. Living in
// the step registry, it made every one of them import the registry; here it
// imports only the vendor error it extends.
//
// SERVER-SAFE: no SDK. Enforced by `server-code-must-not-reach-the-editor-sdk`.
import { PermanentNodeExecutionError } from '../vendor/workflowbuilder/execution-core/errors';

/**
 * The code a wait throws under, and the whole mechanism by which a run pauses.
 *
 * ⚠️ A WAIT TRAVELS AS AN ERROR, on purpose, because there is nowhere else for
 * it to go. The vendored `runGraph` has no suspension point: its scheduler loop
 * runs to completion and `NodeExecutionResult` is `{ output, nextPort? }` with
 * no third option. Read in full 2026-09-13 before choosing this — the execution
 * model DECLARES a `node_waiting` event, but the vendored runner never emits it,
 * and it means "waiting for other nodes" (a join) rather than waiting for a
 * clock.
 *
 * So the node throws, `runGraph` treats it as a fatal failure and returns
 * `{ status: 'failed', error: { code } }` — carrying the code through — and
 * `run-workflow` recognises the code and converts the outcome into a park. The
 * failure events are suppressed there and a real `node_waiting` is emitted
 * instead, so the log says what actually happened.
 *
 * It is matched BY SHAPE, never `instanceof`: the worker runs a bundled copy of
 * this module, so class identity does not survive — the same reason
 * `classifyNodeError` is written that way.
 */
export const WORKFLOW_WAIT_CODE = 'workflow_wait';

export class WorkflowWaitSignal extends PermanentNodeExecutionError {
  readonly resumeAt: string;
  /**
   * The EXTERNAL EVENT this park is waiting for, when there is one.
   *
   * Optional, and optional on purpose: `logic.wait` waits on a clock and has no
   * event, so requiring this would break every wait that exists today. A node
   * that CAN be finished from outside (a phone call ending) names the thing it
   * is waiting for here, and `resumeAt` stays as the timeout ceiling rather than
   * becoming the answer.
   */
  readonly correlationId?: string;

  /**
   * "Has the thing I am about to wait for ALREADY happened?"
   *
   * ⚠️ THE HALF THAT MAKES AN EVENT WAKE RELIABLE RATHER THAN LIKELY. A node
   * decides to park by reading the world, and between that read and the park
   * becoming durable the event can land — the callback then finds a run that is
   * not waiting yet, reports "nothing to wake", and the run sleeps to its
   * ceiling with the answer already sitting in the database.
   *
   * This closes it AGAINST CONCURRENCY with the ordinary REGISTER-then-CHECK
   * handshake: the caller parks, registers the fallback wake-up, and only THEN
   * asks this. Checking before registering would just move the window, not
   * remove it.
   *
   * ⚠️ NOT AGAINST A CRASH. Nothing spans the step row, the run row, the enqueue
   * and this check in one transaction, so a process that dies partway still
   * leaves gaps — see the three of them enumerated in `handleWorkflowRun`. This
   * removes the race between two live actors, which is the one that happens on
   * every healthy call; it does not make the sequence atomic.
   *
   * EPHEMERAL ON PURPOSE. It is a closure over this attempt's own domain, so it
   * never reaches `StepLedgerPort` — that is a persistence contract, and handing
   * a DAL a function it can never store would be an API that lies. It travels
   * through the runner's in-memory `onWait` instead and dies with the
   * invocation.
   *
   * MUST NOT cause the side effect again. It reads the record the node already
   * created; a verifier that re-dispatched would telephone the guest twice.
   */
  readonly verify?: WaitVerifier;

  constructor(resumeAt: string, correlationId?: string, verify?: WaitVerifier) {
    super(WORKFLOW_WAIT_CODE, `ההרצה ממתינה עד ${resumeAt}.`);
    this.name = 'WorkflowWaitSignal';
    this.resumeAt = resumeAt;
    if (correlationId !== undefined) this.correlationId = correlationId;
    if (verify !== undefined) this.verify = verify;
  }
}

/** Answers "already happened?" — see `WorkflowWaitSignal.verify`. */
export type WaitVerifier = () => Promise<boolean>;

/** The wait request carried by an error, or null. By shape — see above. */
export function readWaitSignal(
  error: unknown,
): { resumeAt: string; correlationId?: string; verify?: WaitVerifier } | null {
  if (!(error instanceof Error)) return null;
  const { code, resumeAt, correlationId, verify } = error as {
    code?: unknown;
    resumeAt?: unknown;
    correlationId?: unknown;
    verify?: unknown;
  };
  if (code !== WORKFLOW_WAIT_CODE || typeof resumeAt !== 'string') return null;
  return {
    resumeAt,
    ...(typeof correlationId === 'string' && correlationId !== '' ? { correlationId } : {}),
    ...(typeof verify === 'function' ? { verify: verify as WaitVerifier } : {}),
  };
}
