// The drainer's contract, ported alongside it from the reference backend's
// serialized-drainer.test.ts / drain-order.test.ts.
//
// Every case here is a bug that produces a plausible-looking stream rather than
// an error: duplicated events, a stream that never closes, an event silently
// dropped. None of them would fail a typecheck or a build.
import { describe, expect, it } from 'vitest';

import { createSerializedDrainer, drainEventsSince, type DrainResult } from './drain';
import type { StreamEvent } from './execution-events';

function event(seq: number, type = 'node_completed'): StreamEvent {
  return { seq, type, nodeId: `n${seq}`, payload: {}, timestamp: '2026-09-09T00:00:00.000Z' };
}

describe('drainEventsSince', () => {
  it('advances the cursor to the last event written', async () => {
    const written: number[] = [];
    const result = await drainWith([event(1), event(2), event(3)], async (e) => {
      written.push(e.seq);
    });

    expect(written).toEqual([1, 2, 3]);
    expect(result.lastSeq).toBe(3);
    expect(result.reachedTerminal).toBe(false);
  });

  it('pins the cursor at the last SUCCESSFUL write when the client disconnects', async () => {
    // The cursor must not run ahead of what actually reached the browser: on
    // reconnect the snapshot restarts from 0 anyway, but a drain that advanced
    // past a failed write would drop those events for the life of the stream.
    const result = await drainWith([event(1), event(2), event(3)], async (e) => {
      if (e.seq === 3) throw new Error('client gone');
    });

    expect(result).toMatchObject({ lastSeq: 2, writeFailed: true, reachedTerminal: false });
  });

  it('reports the terminal event so the stream can close', async () => {
    const result = await drainWith([event(1), event(2, 'execution_completed')], async () => {});
    expect(result.reachedTerminal).toBe(true);
  });

  it('does not treat a mid-stream event as terminal', async () => {
    const result = await drainWith([event(1, 'execution_started'), event(2)], async () => {});
    expect(result.reachedTerminal).toBe(false);
  });

  // The fetcher is a parameter, so a test hands it a list — no module mocking,
  // which is the point of keeping the drain logic free of its own I/O.
  function drainWith(
    events: StreamEvent[],
    write: (e: StreamEvent) => Promise<void>,
  ): Promise<DrainResult> {
    return drainEventsSince('run-1', 0, async () => events, write);
  }
});

describe('createSerializedDrainer', () => {
  it('coalesces a burst into one follow-up pass', async () => {
    // Without this, two wake-ups arriving together start parallel drains that
    // both read the stale cursor — and every event is written to the browser
    // twice.
    let inFlight = 0;
    let maxConcurrent = 0;
    let passes = 0;

    const drainer = createSerializedDrainer(0, async (cursor) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      passes += 1;
      await Promise.resolve();
      inFlight -= 1;
      return { lastSeq: cursor, reachedTerminal: false, writeFailed: false };
    });

    await Promise.all([drainer.notify(), drainer.notify(), drainer.notify()]);

    expect(maxConcurrent).toBe(1);
    // One pass for the first notify, one follow-up covering the burst — not
    // three, and never zero.
    expect(passes).toBe(2);
  });

  it('carries the cursor forward between passes', async () => {
    const seen: number[] = [];
    let next = 0;
    const drainer = createSerializedDrainer(0, async (cursor) => {
      seen.push(cursor);
      next += 10;
      return { lastSeq: next, reachedTerminal: false, writeFailed: false };
    });

    await drainer.notify();
    await drainer.notify();

    expect(seen).toEqual([0, 10]);
    expect(drainer.cursor).toBe(20);
  });

  it('stops for good once terminal, so no later notify reopens it', async () => {
    let passes = 0;
    const drainer = createSerializedDrainer(0, async () => {
      passes += 1;
      return { lastSeq: 1, reachedTerminal: true, writeFailed: false };
    });

    await drainer.notify();
    await drainer.notify();

    expect(passes).toBe(1);
    expect(drainer.done).toBe(true);
  });

  it('stops on a failed write — the client is gone, there is nobody to write to', async () => {
    let passes = 0;
    const drainer = createSerializedDrainer(0, async () => {
      passes += 1;
      return { lastSeq: 0, reachedTerminal: false, writeFailed: true };
    });

    await drainer.notify();
    await drainer.notify();

    expect(passes).toBe(1);
    expect(drainer.done).toBe(true);
  });

  it('stop() prevents any further pass', async () => {
    let passes = 0;
    const drainer = createSerializedDrainer(0, async () => {
      passes += 1;
      return { lastSeq: 0, reachedTerminal: false, writeFailed: false };
    });

    drainer.stop();
    await drainer.notify();

    expect(passes).toBe(0);
  });
});
