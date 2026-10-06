import 'server-only';

import {
  REPORT_CATCH_UP_MS,
  REPORT_STRANDED_AFTER_MS,
  REPORT_SWEEP_BATCH,
} from './budgets';
import { planDueSlots } from './planner';
import type { ReportStore } from './store';

// The report planner tick, run by the owner-agent consumer on the existing
// */5 intake-sweep schedule (consumer/main.ts). Every tick:
//
//   1. EXPIRES runs that can no longer be on time: 'queued' or 'processing'
//      runs claimed at least the catch-up window ago. A run is inserted only
//      within the window after its slot, so such a run's slot is older than
//      the window for certain; the handler does the same check by the slot.
//   2. PLANS the due slots (planner.ts) — only while the kill switch AND the
//      reports switch are on and a number is chosen; with either off, no run
//      row is created at all. Each due slot is one INSERT; the UNIQUE key turns
//      a slot already planned into "not inserted", and only an inserted run is
//      enqueued, with deterministicJobId('owner-report:' + runId).
//   3. RE-ENQUEUES what is stranded: 'queued' runs claimed between
//      REPORT_STRANDED_AFTER_MS and the catch-up window ago — an insert whose
//      enqueue failed. Same deterministic id, so a job that exists is not
//      duplicated (pg-boss inserts ON CONFLICT DO NOTHING).
//
// Idempotent: two ticks in a row are one tick. The gates are the handler's
// (report.ts); this only decides what is due.

export interface ReportTickDeps {
  store: ReportStore;
  /** boss.send(QUEUES.ownerAgentReport, { runId }, { id: deterministicJobId('owner-report:' + runId) }). */
  enqueue: (runId: string) => Promise<boolean>;
  log: (line: string) => void;
  now: () => number;
}

export async function runReportTick(
  deps: ReportTickDeps,
): Promise<{ expired: number; planned: number; requeued: number }> {
  const { store } = deps;
  const nowMs = deps.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  let expired = 0;
  for (const id of await store.listStaleRuns(iso(nowMs - REPORT_CATCH_UP_MS), REPORT_SWEEP_BATCH)) {
    if (!(await store.transitionRun(id, ['queued', 'processing'], 'expired', { errorCode: 'late' }))) continue;
    expired += 1;
    await store.writeAudit({ outcome: 'expired', reasonCode: 'late', reportRunId: id });
  }

  let planned = 0;
  const settings = await store.readSettings();
  if (settings?.enabled && settings.reportsEnabled && settings.phoneNumberId) {
    for (const slot of planDueSlots(await store.listPlannable(), nowMs)) {
      const runId = await store.insertRun(slot.subscriptionId, slot.localDate, `${slot.slotTime}:00`);
      if (!runId) continue;
      planned += 1;
      // A failed enqueue leaves the run 'queued'; step 3 of a later tick picks it up.
      await deps.enqueue(runId).catch(() => false);
    }
  }

  let requeued = 0;
  const stranded = await store.listStrandedRuns(
    iso(nowMs - REPORT_STRANDED_AFTER_MS),
    iso(nowMs - REPORT_CATCH_UP_MS),
    REPORT_SWEEP_BATCH,
  );
  for (const id of stranded) {
    if (await deps.enqueue(id)) requeued += 1;
  }

  if (expired > 0 || planned > 0 || requeued > 0) {
    deps.log(`[owner-agent] report tick expired=${expired} planned=${planned} requeued=${requeued}`);
  }
  return { expired, planned, requeued };
}
