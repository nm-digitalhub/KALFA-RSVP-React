'use client';

// The client the live-execution stream never had.
//
// `execution-stream-adapter.ts` and the SSE route
// `/api/admin/workflows/runs/[runId]/stream` were both shipped in 31ba24f, whose
// message advertises "a live execution replay" — but nothing imported the
// adapter and `setExecutionStarted` was never called, so the server streamed to
// nobody. This is the missing half: a control on each row of "הרצות אחרונות"
// that points the canvas, the node markers and the log at that run.
//
// One stream at a time, deliberately. The execution store is a single global
// (the canvas can only show one run), so a second subscription would interleave
// two runs' events into one timeline. The module-level `disconnect` is what
// enforces that — switching rows closes the previous EventSource first.
import { useEffect } from 'react';

// The editor's own component library (@workflowbuilder/ui, the SDK's successor to
// overflow-ui), not the app's shadcn primitives: it carries the editor's tokens.
import { Button } from '@workflowbuilder/ui';

import { connectExecutionStream } from './execution-stream-adapter';
import { resetExecution, setExecutionStarted, useExecutionStore } from './use-execution-store';

let disconnect: (() => void) | null = null;

// ⚠️ WHETHER A HUMAN CHOSE THIS RUN, which `run-auto-watch.tsx` needs and the
// store cannot answer: `runId` says WHICH run is on the canvas, never WHY. Auto
// attaching must never take the canvas away from a run someone opened on
// purpose — they are probably reading it.
let watchedByUser = false;

export function stopWatching() {
  disconnect?.();
  disconnect = null;
  watchedByUser = false;
}

/**
 * Point the canvas, the markers and the log at one run.
 *
 * `byUser` defaults to true because a click is the only caller that does not
 * say otherwise; the auto-watcher passes false.
 */
export function watchRun(runId: string, options?: { byUser?: boolean }) {
  stopWatching();
  // Reset before subscribing: the snapshot that arrives first replaces the
  // store wholesale, but a failed connection would otherwise leave the previous
  // run's nodes lit under the new run's id.
  resetExecution();
  setExecutionStarted(runId);
  disconnect = connectExecutionStream(runId);
  watchedByUser = options?.byUser ?? true;
}

/** True when the run on the canvas got there by a click, not automatically. */
export function isWatchedByUser() {
  return watchedByUser;
}

export function RunWatchButton({ runId }: { runId: string }) {
  const watchedRunId = useExecutionStore((s) => s.runId);
  const isWatching = watchedRunId === runId;

  // Leaving the page must close the socket. Without this the EventSource
  // survives client-side navigation inside /admin and keeps reconnecting to a
  // run nobody is looking at.
  //
  // ⚠️ ONLY IF THIS ROW IS THE ONE BEING WATCHED. Every row renders this button
  // twice — once in the mobile list, once in the desktop table — and a row
  // leaves the DOM whenever it falls out of the twenty the page shows. An
  // unconditional `stopWatching` there would kill a live stream belonging to a
  // different run, which the auto-watcher makes far easier to hit: a new run
  // arriving pushes the oldest row off the end, and the run being watched is
  // usually the newest.
  useEffect(
    () => () => {
      if (useExecutionStore.getState().runId === runId) stopWatching();
    },
    [runId],
  );

  return (
    <Button
      type="button"
      size="s"
      variant={isWatching ? 'primary' : 'secondary'}
      aria-pressed={isWatching}
      onClick={() => {
        if (isWatching) {
          stopWatching();
          resetExecution();
        } else {
          watchRun(runId);
        }
      }}
    >
      {isWatching ? 'עצירת מעקב' : 'הצגה על הקנבס'}
    </Button>
  );
}
