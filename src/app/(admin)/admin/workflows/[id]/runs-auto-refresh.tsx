'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Keep "הרצות אחרונות" current while the page is open.
//
// ⚠️ WHY A REFRESH AND NOT THE SSE STREAM WE ALREADY HAVE. The question is
// obvious enough that the answer belongs here rather than in a commit message.
//
// `/api/admin/workflows/runs/[runId]/stream` is scoped to ONE run id, and three
// things follow from that:
//
//   1. It cannot announce a run that does not exist yet. The run at 18:55:53
//      came from `whatsapp_inbound` — nothing in the browser knew its id until
//      the row existed, which is precisely the case this component covers.
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
// ⚠️ AND NOT SUPABASE REALTIME EITHER, THOUGH THE PROJECT USES IT. Six tables
// sit in `supabase_realtime` and `console-channels.ts` is a well-worn subscriber
// to copy. `workflow_runs` is not one of them, and putting it there was measured
// and rejected: `postgres_changes` replays WHOLE ROWS to the browser —
// `trigger_payload`, which on this very run held a guest's message text, and
// `definition_snapshot` — where `listWorkflowRuns` deliberately selects six
// columns and none of those. Its RLS gate is `is_platform_staff()`, wider than
// the `manage_settings` that loader requires. The platform-native route would
// have widened both the data surface and the authorization gate; the rule about
// not pulling privileged business data into the browser wins.
//
// ⚠️ IT USED TO GO SILENT, AND THAT WAS A BUG — FOUND IN THE BROWSER, NOT BY A
// TEST. `getRunsRefreshInterval` returned `null` once every visible run was
// terminal, on the reasoning that nothing could change afterwards. On 2026-09-18
// an inbound WhatsApp message created a run at 18:55:53 and finished it at
// 18:55:57 while this page sat open and `visible`; the table went on showing the
// previous day's two runs until it was reloaded by hand. A trigger fires with no
// browser involved, so "everything I can see has finished" says nothing about
// what is about to appear. The tests passed throughout — they pinned the policy
// that was written, not the behaviour that was wanted.
//
// ⚠️ SO THE IDLE TICK ASKS A QUESTION INSTEAD OF REFRESHING. `router.refresh()`
// re-runs the whole page — seven uncached queries — and idle, the answer is
// almost always "nothing changed". `/api/admin/workflows/<id>/runs/latest` is
// ONE query returning a hash of the same twenty rows the table renders, and the
// refresh happens only when that hash differs from the one the page was rendered
// with. An open page therefore costs one cheap query per tick, not seven.
//
// ⚠️ STARTING A RUN IS ALREADY HANDLED, AND NOT HERE. `startManualRunAction`
// ends with `revalidatePath('/admin/workflows/<id>')` before it returns, so the
// fresh payload rides back with the action's own response and the new row is on
// screen immediately.
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
const IDLE_MS = 25_000;

/**
 * How often to ask whether the runs list has changed.
 *
 * A pure function on purpose: the interesting behaviour is the POLICY, and a
 * test should be able to state it without fake timers or a rendered tree.
 *
 * ⚠️ IT NEVER RETURNS `null` ANY MORE. See the note above: going quiet is what
 * hid a real run from a page that was open and looking straight at the table.
 * Idle is slower than the others, not absent.
 *
 * ⚠️ `waiting` IS SEPARATED FROM THE OTHERS BECAUSE IT IS NOT A BUSY STATE.
 * `logic.wait` parks a run for minutes or days, and polling every four seconds
 * for three days to watch a value that cannot change until a scheduled job
 * fires would be the same mistake this file exists to avoid. A minute is enough
 * to notice the wake.
 *
 * ⚠️ AND PARKED IS SLOWER THAN IDLE ON PURPOSE. A parked run's own wake is a
 * scheduled event that a minute of latency cannot miss; an idle page is waiting
 * for something that may arrive at any second, and it is now the cheap check
 * that runs, so it can afford to be more frequent.
 */
export function getRunsRefreshInterval(
  statuses: readonly WorkflowRunStatus[],
): number {
  if (statuses.some((status) => ACTIVE.includes(status))) return ACTIVE_MS;
  if (statuses.some((status) => status === 'waiting')) return PARKED_MS;
  return IDLE_MS;
}

type Props = {
  workflowId: string;
  statuses: readonly WorkflowRunStatus[];
  /**
   * The fingerprint of the rows this page was rendered with.
   *
   * ⚠️ SEEDED FROM THE SERVER, NOT FROM THE FIRST POLL. Learning it from the
   * first response would silently swallow anything that happened between the
   * render and that response — which is exactly the window a trigger fires in.
   */
  fingerprint: string;
};

export function RunsAutoRefresh({ workflowId, statuses, fingerprint }: Props) {
  const router = useRouter();

  // The statuses come from the server render — including the one
  // `revalidatePath` triggers when a run starts. The array identity changes on
  // every render even when nothing moved. Keying the effect on the interval
  // means a steady state re-uses the same timer instead of tearing one down and
  // building another every cycle.
  const interval = getRunsRefreshInterval(statuses);

  // A ref and not state: changing it must not re-render, and the effect below
  // must always read the CURRENT value rather than the one captured when its
  // timer was created.
  const known = useRef(fingerprint);

  // ⚠️ SYNCED IN AN EFFECT, NOT IN THE RENDER BODY. Assigning here directly is
  // what `react-hooks/refs` flags as "Cannot update ref during render", and the
  // rule is not a formality: React may run a render and throw the result away,
  // and a ref written during that attempt keeps a value from a render that never
  // happened.
  //
  // This only fires when the PROP changes — i.e. when the server has re-rendered
  // the table — so it cannot undo the advance the poll below makes while a
  // `router.refresh()` is still in flight. That matters: reverting it there
  // would make the next tick see the same difference again and queue a second
  // refresh for a change already handled.
  useEffect(() => {
    known.current = fingerprint;
  }, [fingerprint]);

  useEffect(() => {
    const controller = new AbortController();

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(
          `/api/admin/workflows/${workflowId}/runs/latest`,
          { signal: controller.signal, cache: 'no-store' },
        );
        // A 401/403/500 here is not worth surfacing: the page itself is still
        // whatever the server last rendered, and the next tick tries again.
        // Throwing or toasting would turn a transient blip into noise on a page
        // someone is working in.
        if (!response.ok) return;
        const { fingerprint: latest } = (await response.json()) as {
          fingerprint?: string;
        };
        if (typeof latest !== 'string' || latest === known.current) return;

        // Record BEFORE refreshing. `router.refresh()` is async and a second
        // tick could land before the new render arrives; without this the same
        // change would queue a second, pointless full refresh.
        known.current = latest;
        router.refresh();
      } catch {
        // Aborted on unmount, or the network blinked. Either way, next tick.
      }
    };

    // ⚠️ CHECK ON RETURN, NOT ONLY ON THE TIMER. A hidden tab skips its ticks,
    // so coming back after a minute would otherwise show a stale table until the
    // next one. Someone switching back to check on a run wants the answer then.
    const onVisible = () => {
      void check();
    };

    const id = setInterval(() => void check(), interval);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [interval, router, workflowId]);

  return null;
}
