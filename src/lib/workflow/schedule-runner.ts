import 'server-only';

// The I/O half of `trigger.schedule`: read the armed workflows, ask the pure
// planner which of them the clock starts right now, and create the run rows.
//
// Split from `schedule.ts` for the same reason `inbound.ts` is split from
// `trigger.ts`: the decision is pure and testable without a database, and only
// the reads and writes live here.
//
// Nothing is enqueued here — the caller (the worker, which holds `boss`) does
// that, exactly as `createRunsForInboundMessage` leaves it to `startWorkflowRuns`.
import { planScheduledRuns } from './schedule';
import { createRunIfNew, listArmedWorkflows } from './store';

/**
 * Create a run for every armed workflow whose schedule matches this moment.
 *
 * Returns the ids that did NOT exist a moment ago. A redelivered tick — pg-boss
 * may deliver the same cron fire twice, and the sweep runs every minute against
 * a slot that lasts a minute — returns an empty list and enqueues nothing,
 * because `workflow_runs_dedupe_key_uidx` is what decides rather than a
 * check-then-insert.
 *
 * `now` is a parameter rather than read inside, so a test can drive a specific
 * minute (including both DST transitions) without touching the system clock.
 */
export async function createScheduledRuns(now: Date = new Date()): Promise<string[]> {
  const armed = await listArmedWorkflows();
  if (armed.length === 0) return [];

  const planned = planScheduledRuns(armed, now);
  if (planned.length === 0) return [];

  const created: string[] = [];
  for (const plan of planned) {
    const runId = await createRunIfNew(plan);
    // `undefined` means the row already existed — this slot already fired. The
    // first creator enqueued it; reporting it again would double-count.
    if (runId) created.push(runId);
  }

  return created;
}
