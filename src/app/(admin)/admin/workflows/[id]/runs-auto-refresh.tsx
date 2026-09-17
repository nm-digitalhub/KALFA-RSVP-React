'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Keep "הרצות אחרונות" current while a run is in flight.
//
// ⚠️ WHY A REFRESH AND NOT THE SSE STREAM WE ALREADY HAVE. The question is
// obvious enough that the answer belongs here rather than in a commit message.
//
// `/api/admin/workflows/runs/[runId]/stream` is scoped to ONE run id, and three
// things follow from that:
//
//   1. It cannot announce a run that does not exist yet. The run at 23:41 came
//      from `whatsapp_inbound` — nothing in the browser knew its id until the
//      row existed, which is precisely the case this component covers.
//   2. `use-execution-store` is a single global, because the canvas can only
//      show one run. `run-watcher.tsx` enforces one stream at a time for that
//      reason; a second subscription opened by this table would interleave two
//      runs' events into one timeline.
//   3. A `waiting` run deliberately never closes its stream
//      (see execution-stream-adapter.ts), so auto-subscribing here would open a
//      five-minute reconnect loop per parked run, per open tab — and that file
//      states plainly that changing the parked-run policy is blocked on mapping
//      the whole wake path first.
//
// ⚠️ STARTING A RUN IS ALREADY HANDLED, AND NOT HERE. `startManualRunAction`
// ends with `revalidatePath('/admin/workflows/<id>')` before it returns, so the
// fresh payload rides back with the action's own response and the new row is on
// screen immediately. A `router.refresh()` in the panel would be a second full
// re-render of the same page microseconds after the first — fourteen uncached
// queries where seven already ran. This component covers only what that path
// cannot: a status that keeps changing AFTER the action returned, and a run
// created by a trigger no browser was watching.
//
// The vendor is no help either, and that was checked rather than assumed: the
// SDK ships NO execution surface at all. `executionStore`, `execution_snapshot`,
// `EventSource`, `node_started`, `run_status` — zero occurrences in the 606 KB
// bundle, and the only status-shaped exports are `DidSaveStatus` (saving) and
// `statusOptions` (a node's own lifecycle). Their own docs say it outright:
// "Run history and live run lists are entirely the host application's
// responsibility."
//
// So the table stays a Server Component and `router.refresh()` re-runs it. Next
// merges the new RSC payload "without losing unaffected client-side React
// (e.g. useState) or browser state (e.g. scroll position)" — which is what makes
// this safe on a page that also holds a live editor: the canvas, its selection,
// the viewport and the open panels all survive.
//
// ⚠️ IT REFETCHES THE WHOLE PAGE, and that is the real cost: seven uncached
// queries per cycle. It is acceptable only because the window is short —
// measured over the stored runs, the average is 14s and the longest 129s, so an
// active run costs a couple of dozen queries in total, not a standing load. The
// analytics auto-refresh carries the matching warning ("if a non-cached section
// is ever added to the page, this interval multiplies its load"); here the
// interval is bounded by the run itself instead of by a cache.

/** Every value the `workflow_runs.status` CHECK constraint allows. */
export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled';

/** A run the engine is actively moving. Worth watching closely. */
const ACTIVE: readonly WorkflowRunStatus[] = ['pending', 'running', 'cancelling'];

const ACTIVE_MS = 4_000;
const PARKED_MS = 60_000;

/**
 * How often to re-read the table, or `null` to stop entirely.
 *
 * A pure function on purpose: the interesting behaviour is the POLICY, and a
 * test should be able to state it without fake timers or a rendered tree.
 *
 * ⚠️ `waiting` IS SEPARATED FROM THE OTHERS BECAUSE IT IS NOT A BUSY STATE.
 * `logic.wait` parks a run for minutes or days, and polling every four seconds
 * for three days to watch a value that cannot change until a scheduled job
 * fires would be the same mistake this file exists to avoid. A minute is enough
 * to notice the wake.
 */
export function getRunsRefreshInterval(
  statuses: readonly WorkflowRunStatus[],
): number | null {
  if (statuses.some((status) => ACTIVE.includes(status))) return ACTIVE_MS;
  if (statuses.some((status) => status === 'waiting')) return PARKED_MS;
  return null;
}

export function RunsAutoRefresh({ statuses }: { statuses: readonly WorkflowRunStatus[] }) {
  const router = useRouter();

  // The statuses come from the server render — including the one `revalidatePath`
  // triggers when a run starts, which is what first reports a non-terminal
  // status here and sets the timer going. The array identity changes on
  // every render even when nothing moved. Keying the effect on the interval
  // means a steady state re-uses the same timer instead of tearing one down and
  // building another every cycle.
  const interval = getRunsRefreshInterval(statuses);

  useEffect(() => {
    if (interval === null) return;

    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    // ⚠️ REFRESH ON RETURN, NOT ONLY ON THE TIMER. A hidden tab skips its ticks,
    // so coming back after a minute would otherwise show a stale table until the
    // next one. Someone switching back to check on a run wants the answer then.
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    const id = setInterval(tick, interval);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [interval, router]);

  return null;
}
