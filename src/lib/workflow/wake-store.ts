import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// The database half of an event wake, on its own — and on its own for TWO
// reasons, one of which is structural.
//
// ⚠️ ONE SOURCE OF TRUTH FOR THE CAS. Two callers need it with very different
// queue situations: the callback route runs in the web tier and has to open a
// send-only pg-boss connection, while the worker already holds a `boss` and
// would be opening a second one for nothing. Splitting the RPC out lets each
// bring its own queue handle to the same gate.
//
// ⚠️ AND IT BREAKS AN IMPORT CYCLE. `wake.ts` needs `pullWorkflowRunForward`
// from `enqueue.ts`, and `enqueue.ts` needs this CAS — so putting the CAS in
// `wake.ts` made `enqueue → wake → enqueue`. ESM's live bindings often survive a
// cycle, but the scheduler's core is the last place to rely on "often": which
// module finishes initialising first then depends on entry order, and the
// failure is an undefined import at run time, not a build error. This file
// imports nothing from either.

/**
 * Move a parked run's step deadline to now, if it is still waiting on this
 * exact event.
 *
 * IDEMPOTENT, and that is load-bearing rather than incidental. The RPC predicates
 * on the run being `waiting` with this `resume_correlation_id` and the step being
 * `waiting`; it changes `wait_until` and nothing else, so a second call with the
 * same arguments matches the same rows and answers the same way.
 *
 * That is what lets the callback and the parking worker race freely: whichever
 * arrives second still gets `true` and can complete the delivery the first one
 * could not. MEASURED against the live function on 2026-09-14 — callback CAS
 * true, second CAS true, a different correlation false.
 *
 * `false` means the run is genuinely not waiting on this event: it moved on, or
 * it parked again for another reason. Nothing is written.
 */
export async function markParkedRunReady(args: {
  runId: string;
  nodeId: string;
  correlationId: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('wake_parked_workflow_run', {
    p_run_id: args.runId,
    p_node_id: args.nodeId,
    p_correlation_id: args.correlationId,
  });
  if (error) throw new Error(`markParkedRunReady failed: ${error.message}`);
  return data === true;
}
