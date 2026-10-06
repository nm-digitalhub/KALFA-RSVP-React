// The pure half of the execution stream: draining and serializing.
//
// Split from the I/O exactly as the reference backend splits it
// (events/drain-events.ts + events/serialized-drainer.ts take a fetcher;
// events/fetch-events-after.ts does the query). Keeping this module free of
// `server-only` is what makes the cursor logic testable — and the cursor logic
// is where every bug in a stream lives.
import { isTerminalEventType, type StreamEvent } from './execution-events';

export type EventFetcher = (runId: string, afterSeq: number) => Promise<StreamEvent[]>;

export type DrainResult = {
  lastSeq: number;
  reachedTerminal: boolean;
  /** The write callback threw — for SSE that is the client disconnecting. */
  writeFailed: boolean;
};

/**
 * Write every event after the cursor, and report where it got to.
 *
 * REQUIRES rows to become visible in ascending `seq` order. The cursor only ever
 * moves forward, so a row that commits below it is never selected again and its
 * event is lost outright. `bigserial` allocates at INSERT and Postgres publishes
 * at COMMIT, so two concurrent inserts can commit out of order — which our
 * runner would do, since `runGraph` runs a wave's nodes through `Promise.all`.
 * `createExecutionLog` in store.ts is what upholds the ordering, by chaining its
 * appends.
 */
export async function drainEventsSince(
  runId: string,
  afterSeq: number,
  fetch: EventFetcher,
  write: (event: StreamEvent) => Promise<void>,
): Promise<DrainResult> {
  const events = await fetch(runId, afterSeq);

  let lastSeq = afterSeq;
  for (const event of events) {
    try {
      await write(event);
    } catch {
      // The cursor stays pinned at the last event that actually reached the
      // client. Advancing past a failed write would drop those events for the
      // life of the stream.
      return { lastSeq, reachedTerminal: false, writeFailed: true };
    }
    lastSeq = event.seq;
  }

  const lastType = events.at(-1)?.type;
  return {
    lastSeq,
    reachedTerminal: lastType !== undefined && isTerminalEventType(lastType),
    writeFailed: false,
  };
}

/**
 * Serializes drain passes for one subscriber.
 *
 * Two wake-ups in quick succession would otherwise start parallel drains that
 * both read the stale cursor and write every row twice. A burst is coalesced
 * into a single follow-up pass after the in-flight drain settles.
 */
export function createSerializedDrainer(
  initialCursor: number,
  drain: (cursor: number) => Promise<DrainResult>,
) {
  let cursor = initialCursor;
  let draining = false;
  let pendingNotify = false;
  let done = false;

  async function notify(): Promise<void> {
    if (done) return;
    if (draining) {
      pendingNotify = true;
      return;
    }
    draining = true;
    try {
      do {
        pendingNotify = false;
        const result = await drain(cursor);
        cursor = result.lastSeq;
        if (result.reachedTerminal || result.writeFailed) {
          done = true;
          return;
        }
      } while (pendingNotify && !done);
    } finally {
      draining = false;
    }
  }

  return {
    notify,
    stop() {
      done = true;
    },
    get done() {
      return done;
    },
    get cursor() {
      return cursor;
    },
  };
}
