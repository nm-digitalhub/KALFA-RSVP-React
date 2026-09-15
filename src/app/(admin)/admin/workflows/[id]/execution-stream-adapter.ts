'use client';

// Ported from the reference app's src/adapters/execution-stream-adapter.ts.
// Same framing, same terminal detection, same retry budget.
//
// The one shape difference: their stream serves bare events plus a snapshot
// distinguished by duck-typing (`'events' in parsed && 'lastSequence' in
// parsed`). Ours tags the snapshot explicitly with `type:
// 'execution_snapshot'`, because duck-typing a wire format means a future event
// that happens to carry an `events` key would be silently mistaken for a
// snapshot and reset the whole store.
import {
  applyConnectionLost,
  applyEvent,
  applySnapshot,
} from './use-execution-store';

import { isTerminalEventType, isTerminalStatus } from '@/lib/workflow/execution-events';
import type { StreamEvent, StreamSnapshot } from '@/lib/workflow/execution-events';

const MAX_RETRIES = 5;

type WireMessage = ({ type: 'execution_snapshot' } & StreamSnapshot) | StreamEvent;

/**
 * Subscribe to one run's event stream. Returns the unsubscribe.
 *
 * EventSource reconnects on its own; `retries` bounds how many times we let it,
 * after which the store is told the connection is lost rather than leaving a
 * spinner turning forever. A successful message resets the budget, so a long
 * run that blips is not eventually killed by unrelated earlier blips.
 */
export function connectExecutionStream(runId: string): () => void {
  const eventSource = new EventSource(`/api/admin/workflows/runs/${runId}/stream`);
  let retries = 0;

  eventSource.addEventListener('message', (message: MessageEvent<string>) => {
    if (!message.data) return;
    retries = 0;

    let parsed: WireMessage;
    try {
      parsed = JSON.parse(message.data) as WireMessage;
    } catch {
      // A malformed frame is not a reason to tear down a live run's stream.
      return;
    }

    if ('type' in parsed && parsed.type === 'execution_snapshot') {
      const snapshot = parsed as { type: string } & StreamSnapshot;
      applySnapshot(snapshot);
      // Closing on a terminal SNAPSHOT is what stops an endless reconnect loop
      // when the page opens on a run that already finished.
      if (isTerminalStatus(snapshot.status)) eventSource.close();
      return;
    }

    const event = parsed as StreamEvent;
    applyEvent(event);
    if (isTerminalEventType(event.type)) eventSource.close();
  });

  // ⚠️ A PARKED RUN DELIBERATELY DOES NOT CLOSE THIS, and the question is worth
  // answering here because it looks like a leak.
  //
  // `waiting` is in neither TERMINAL_STATUSES nor TERMINAL_EVENT_TYPES — those
  // two lists are the vendor's vocabulary, mirrored by a check constraint on the
  // runs table, and a run that will resume has not finished. So a `logic.wait`
  // parked for three days leaves this subscribed: the server caps a connection
  // at MAX_STREAM_MS (5 minutes) and closes, EventSource reconnects, and that
  // repeats while the tab stays on this page.
  //
  // That is the intended behaviour for now, and changing it is blocked on
  // evidence rather than on taste. Closing here would mean a canvas that
  // silently stops updating: a run that wakes two minutes later shows a parked
  // node forever while the button still reads "עצירת מעקב", and a watcher that
  // lies is worse than a request that repeats.
  //
  // ⚠️ BEFORE ANYONE CHANGES THIS, the whole wake path has to be mapped and
  // proven end to end —
  //
  //     waiting → the pg-boss job fires → resume → running → the browser is told
  //
  // — because only the last arrow makes closing safe. Today nothing pushes to a
  // closed tab, so the open stream IS the notification. The cost is one request
  // per five minutes per open tab.
  //
  // Nothing accumulates: `run-watcher.tsx` closes on unmount and before opening
  // a second stream, so at most one is ever live.

  eventSource.addEventListener('error', () => {
    if (++retries > MAX_RETRIES) {
      eventSource.close();
      applyConnectionLost();
    }
  });

  return () => {
    eventSource.close();
  };
}
