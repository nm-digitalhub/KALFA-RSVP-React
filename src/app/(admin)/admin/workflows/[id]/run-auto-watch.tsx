'use client';

import { useLocalStorage } from '@mantine/hooks';
import { useEffect, useRef } from 'react';

// The editor's own component library (@workflowbuilder/ui, the SDK's successor to
// overflow-ui), not the app's shadcn primitives: it carries the editor's tokens.
import { Switch } from '@workflowbuilder/ui';

import { isWatchedByUser, watchRun } from './run-watcher';

// Put a run on the canvas the moment it appears, without anyone clicking.
//
// Every piece this needs already existed. `execution-stream-adapter.ts` streams
// one run's events, `use-execution-store` holds them, `node-markers.tsx` lights
// the nodes and `node-run-control.tsx` reports per node. The only missing link
// was that a run nobody clicked "הצגה על הקנבס" for stayed unwatched — and a run
// created by a trigger is exactly the kind nobody clicked.
//
// ⚠️ WHAT THIS DOES AND DOES NOT BUY, measured rather than hoped. The live run
// on 2026-09-18 emitted its whole event sequence in 2.1 seconds
// (`execution_started` 19:11:54.994 → `execution_completed` 19:11:57.094), and
// the table noticed it 7 seconds after it ended. So on a short workflow this
// shows the FINISHED state without a click, not an animation. The animation is
// real on the long ones — `logic.wait`, a voice call, `for-each` over a guest
// list — and those are the runs worth watching anyway.
//
// Chasing sub-second latency would mean a push channel, i.e. Realtime on
// `workflow_runs`, whose cost is written down in `runs-auto-refresh.tsx`: whole
// rows to the browser, `trigger_payload` included, under a wider gate. Not worth
// it to animate two seconds.

/**
 * ⚠️ DEFAULT ON. An absent key is a reader who has never touched the switch, and
 * they get the feature. The two other auto-refresh toggles in /admin default
 * OFF; copying their `defaultValue: false` here would have made this default
 * off and looked right.
 *
 * Mantine's useLocalStorage: the default on the server and in the first client
 * render (no hydration mismatch), the stored value from an effect right after,
 * kept in step across tabs and within this one. A browser with site data
 * blocked (where `localStorage` THROWS) gets the default instead of taking the
 * whole editor down.
 */
const STORAGE_KEY = 'kalfa-workflow-auto-watch';

export type NewestRun = { id: string; status: string } | null;

/**
 * Whether a newly-appeared run should be put on the canvas.
 *
 * A pure function on purpose, like `getRunsRefreshInterval` beside it: the
 * interesting part is the RULE, and every clause below is a way this feature
 * could go wrong rather than a condition for its own sake. A test should be able
 * to state each one without a rendered tree.
 */
export function shouldAutoWatch(args: {
  enabled: boolean;
  /** Nothing has been seen yet, so there is no "appeared" to speak of. */
  isFirstRender: boolean;
  newest: NewestRun;
  previousId: string | null;
  watchedByUser: boolean;
}): boolean {
  const { enabled, isFirstRender, newest, previousId, watchedByUser } = args;

  // Seeding, not an event: attaching here would light the canvas with whatever
  // ran last — possibly yesterday — every time the page opens.
  if (isFirstRender) return false;
  if (!newest) return false;
  if (newest.id === previousId) return false;

  if (!enabled) return false;

  // Never take the canvas from a run someone opened. They are reading it.
  if (watchedByUser) return false;

  // Never attach to a parked run: `waiting` is not terminal, so the stream never
  // closes and EventSource reconnects every five minutes for as long as the tab
  // is open. Acceptable when a person chose it; not to take on unasked.
  if (newest.status === 'waiting') return false;

  return true;
}

export function RunAutoWatch({ newestRun }: { newestRun: NewestRun }) {
  const [enabled, setEnabled] = useLocalStorage({ key: STORAGE_KEY, defaultValue: true });

  // The newest run this component has already reacted to.
  //
  // ⚠️ SEEDED ON THE FIRST RENDER AND DELIBERATELY NOT ACTED ON. Attaching to
  // whatever happens to be newest at mount would light the canvas with
  // yesterday's run every time the page opens — the opposite of what someone
  // opening an editor wants. The rule is "a run that APPEARED while I was
  // looking", not "the newest run".
  const seen = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const isFirstRender = seen.current === undefined;
    const previousId = isFirstRender ? null : (seen.current ?? null);
    const newestId = newestRun?.id ?? null;

    // ⚠️ ADOPTED BEFORE THE RULE IS CONSULTED, NOT AFTER. A run that appears
    // while the switch is off has still appeared; leaving it unseen would make
    // turning the switch back on later attach to a run from minutes ago.
    seen.current = newestId;

    if (
      shouldAutoWatch({
        enabled,
        isFirstRender,
        newest: newestRun,
        previousId,
        watchedByUser: isWatchedByUser(),
      })
    ) {
      watchRun(newestId!, { byUser: false });
    }
  }, [newestRun?.id, newestRun?.status, newestRun, enabled]);

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Switch checked={enabled} onChange={(checked) => setEnabled(checked)} />
      הצגה אוטומטית של הרצה חדשה על הקנבס
    </label>
  );
}
