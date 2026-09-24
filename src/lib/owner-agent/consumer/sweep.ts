import 'server-only';

import type { OwnerAgentReplyJob } from '@/lib/queue/queues';

import { ANSWER_WINDOW_MS } from './reply';
import type { ReplyStore } from './store';

// The stranded-intake sweep (stage-4 review): an intake row whose job never
// made it into the queue stays 'queued' for good — the route answered Meta 200,
// and a Meta retry of the same wamid is a `duplicate` with no enqueue
// (plan §8 stage 4, known limitations). Every few minutes this:
//
//   1. EXPIRES what can no longer be answered: rows still queued or
//      processing whose question is 24h old or more. Meta refuses a free-form
//      reply outside the window (131047, §2.4), so the row is closed with an
//      audit row (sweep/expired/window_closed) instead of being answered.
//   2. RE-ENQUEUES what is stranded: 'queued' rows between STRANDED_AFTER_MS
//      and REENQUEUE_UNTIL_MS old, each with deterministicJobId(wamid) — the
//      SAME id the route used. pg-boss inserts ON CONFLICT DO NOTHING, so a job
//      that exists (waiting, running, even completed and not yet deleted) is
//      not duplicated, and running the sweep twice is the same as once.
//
// Between 23h and 24h a row is left alone: too late to be worth a new job,
// not yet past the window. Rows in `processing` are the handler's; a job that
// exhausted its retries leaves one there, and step 1 closes it at 24h.

/** A 'queued' row younger than this is assumed to have its job in flight. */
export const STRANDED_AFTER_MS = 2 * 60 * 1000;
/** Re-enqueue no later than this: an answer should still arrive inside the 24h window. */
export const REENQUEUE_UNTIL_MS = 23 * 60 * 60 * 1000;
/** Rows per tick; the next tick takes the rest. */
export const SWEEP_BATCH = 100;

export interface SweepDeps {
  store: ReplyStore;
  /**
   * boss.send(QUEUES.ownerAgentReply, job, { id: deterministicJobId(wamid) }).
   * true when a job was created, false when pg-boss already had one by that id.
   */
  enqueue: (job: OwnerAgentReplyJob, wamid: string) => Promise<boolean>;
  log: (line: string) => void;
  now: () => number;
}

export async function runStrandedIntakeSweep(deps: SweepDeps): Promise<{ expired: number; requeued: number }> {
  const nowMs = deps.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  let expired = 0;
  for (const row of await deps.store.listExpirable(iso(nowMs - ANSWER_WINDOW_MS), SWEEP_BATCH)) {
    if (!(await deps.store.transition(row.id, ['queued', 'processing'], 'expired'))) continue;
    expired += 1;
    // An audit row that fails to write does not undo the expiry; the count
    // below still says it happened.
    await deps.store.writeAudit({
      stage: 'sweep',
      outcome: 'expired',
      reasonCode: 'window_closed',
      staffUserId: row.staffUserId,
      intakeId: row.id,
      wamid: row.wamid,
    });
  }

  let requeued = 0;
  const stranded = await deps.store.listStranded(
    iso(nowMs - STRANDED_AFTER_MS),
    iso(nowMs - REENQUEUE_UNTIL_MS),
    SWEEP_BATCH,
  );
  for (const row of stranded) {
    if (await deps.enqueue({ intakeId: row.id }, row.wamid)) requeued += 1;
  }

  // Counts only: rows closed, and jobs that did not exist and do now.
  if (expired > 0 || requeued > 0) {
    deps.log(`[owner-agent] sweep expired=${expired} requeued=${requeued}`);
  }
  return { expired, requeued };
}
