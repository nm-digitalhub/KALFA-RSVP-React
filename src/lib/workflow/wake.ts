import 'server-only';

import { getWebJobSender } from '@/lib/queue/web-sender';

import { pullWorkflowRunForward } from './enqueue';
import { markParkedRunReady } from './wake-store';

// Wake a workflow run that is parked on an external event, because the event
// happened (step 0ב-3 / 0ב-4).
//
// Until now a parked run could only be woken by TIME. `logic.wait` names a
// duration and pg-boss holds a delayed job until it elapses, which is exactly
// right for "wait two days" and exactly wrong for "wait until this phone call
// ends": the only way to express that was to guess, so a seven-minute call was
// checked at minute five and a call that failed on dial still burned the whole
// wait.
//
// THE TWO HALVES, and why the order is not arbitrary:
//
//   1. The DATABASE half (`wake_parked_workflow_run`) moves the step's own
//      deadline to now. This is the half that makes the wait passable at all —
//      `claimStep` reads `workflow_run_steps.wait_until`, and a replay that
//      arrives early while it is still in the future reads 'in_flight' and FAILS
//      the run with `step_in_flight`. It is also the durable half: once it is
//      written, every later delivery of this run passes the wait, whether it
//      arrives from the wake below, from the `resume_at` ceiling, or from the
//      recovery sweep.
//
//   2. The QUEUE half (`pullWorkflowRunForward`) only decides WHEN the run finds
//      out. It edits the pending job in place rather than adding one, and it
//      reports false when there is no pending job to edit — see there.
//
// So a failure of (2) costs latency and nothing else, and (1) is never done
// speculatively: it runs only when the run is still parked on THIS correlation.
export type WakeOutcome = {
  /** The run was parked on this event and its step deadline was moved. */
  woke: boolean;
  /** The pending queue job was pulled forward. False is not an error. */
  delivered: boolean;
};

export async function wakeParkedRun(args: {
  runId: string;
  nodeId: string;
  correlationId: string;
}): Promise<WakeOutcome> {
  const woke = await markParkedRunReady(args);
  // NOT woken means the run is not waiting on this event — it already moved on,
  // or it parked again for something else. Pulling its job forward then would
  // deliver a run early for a reason that no longer applies, so the queue half
  // is skipped entirely rather than fired "just in case".
  if (!woke) return { woke: false, delivered: false };

  const boss = await getWebJobSender();
  return { woke: true, delivered: await pullWorkflowRunForward(boss, args.runId) };
}
