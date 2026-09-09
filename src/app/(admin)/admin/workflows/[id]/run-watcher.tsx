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

import { Button } from '@/components/ui/button';

import { connectExecutionStream } from './execution-stream-adapter';
import { resetExecution, setExecutionStarted, useExecutionStore } from './use-execution-store';

let disconnect: (() => void) | null = null;

function stopWatching() {
  disconnect?.();
  disconnect = null;
}

function watchRun(runId: string) {
  stopWatching();
  // Reset before subscribing: the snapshot that arrives first replaces the
  // store wholesale, but a failed connection would otherwise leave the previous
  // run's nodes lit under the new run's id.
  resetExecution();
  setExecutionStarted(runId);
  disconnect = connectExecutionStream(runId);
}

export function RunWatchButton({ runId }: { runId: string }) {
  const watchedRunId = useExecutionStore((s) => s.runId);
  const isWatching = watchedRunId === runId;

  // Leaving the page must close the socket. Without this the EventSource
  // survives client-side navigation inside /admin and keeps reconnecting to a
  // run nobody is looking at.
  useEffect(() => stopWatching, []);

  return (
    <Button
      type="button"
      size="sm"
      variant={isWatching ? 'secondary' : 'outline'}
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
