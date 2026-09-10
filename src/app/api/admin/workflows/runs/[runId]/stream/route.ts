import { NextResponse, type NextRequest } from 'next/server';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { isTerminalStatus, type StreamEvent } from '@/lib/workflow/execution-events';
import { createSerializedDrainer, drainEventsSince } from '@/lib/workflow/drain';
import { fetchEventsAfter } from '@/lib/workflow/stream';

// SSE for one run's execution events, ported from the reference backend's
// GET /executions/:id/stream.
//
// AUTHORIZATION IS OURS, NOT THEIRS. Their README says it plainly: "Reference
// implementation, local development only. No real authentication. The bundled
// AllowAllAuthPort permits every caller and every action." This route gates on
// the same cookie session as every other admin surface — and on
// `view_customer_data`, not the coarse staff floor, because the sentence below
// is the whole argument: the stream carries a guest's message text and a guest
// id, so it is exactly as sensitive as the run row it describes. It was
// `requireAdmin()` until 2026-09-10, which let an auditor read guest messages.
//
// Their own file flags the reason this matters more here than elsewhere:
// EventSource cannot send an Authorization header, so an SSE endpoint's auth
// falls back to whatever the browser sends by itself. For us that is the
// session cookie, which is the same credential the page was rendered with —
// no query-param token, nothing weaker than the rest of /admin.

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;
const POLL_MS = 500;
// A run that never reaches a terminal event must not hold a connection forever.
// Comfortably longer than any run we can currently produce, and short enough
// that a wedged stream frees its socket.
const MAX_STREAM_MS = 5 * 60_000;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  await requirePlatformPermission('view_customer_data');

  const { runId } = await params;

  const supabase = createAdminClient();
  const run = await supabase
    .from('workflow_runs')
    .select('id, status')
    .eq('id', runId)
    .maybeSingle();

  if (run.error || !run.data) {
    return NextResponse.json({ code: 'run_not_found' }, { status: 404 });
  }
  // Read out before the stream closure: TypeScript cannot carry the narrowing
  // above into an async callback, and re-checking inside would be noise.
  const rowStatus = run.data.status;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (data: string, event?: string) => {
        if (closed) throw new Error('stream closed');
        const frame = event ? `event: ${event}\ndata: ${data}\n\n` : `data: ${data}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client aborting. Nothing to do.
        }
      };

      // Catch-up snapshot, through the same query the live drain uses
      // (afterSeq = 0) — one query shape across the route, so the snapshot
      // cannot disagree with what follows it.
      const existing = await fetchEventsAfter(runId, 0);
      const lastSeq = existing.length > 0 ? existing.at(-1)!.seq : 0;

      // THE ROW IS NOT THE AUTHORITY ON "OVER". The terminal event and the
      // terminal status are two separate writes (emitEvent, then setRunStatus),
      // so a row read here can still say 'running' after the run has finished.
      // Trusting it would send a live-looking snapshot — and the client closes
      // only on a terminal status, so it would reconnect forever — while seeding
      // the drainer past the last event, so the catch-up drain returns nothing
      // and the stream just heartbeats until the browser gives up. The last
      // EVENT is the authority.
      const lastEventType = existing.at(-1)?.type;
      const effectiveStatus = lastEventType
        ? eventTypeToStatus(lastEventType) ?? rowStatus
        : rowStatus;

      try {
        send(
          JSON.stringify({
            type: 'execution_snapshot',
            runId,
            status: effectiveStatus,
            lastSequence: lastSeq,
            events: existing,
          }),
        );
      } catch {
        close();
        return;
      }

      if (isTerminalStatus(effectiveStatus)) {
        close();
        return;
      }

      const writeEvent = async (event: StreamEvent) => {
        send(JSON.stringify(event));
      };

      const drainer = createSerializedDrainer(lastSeq, (cursor) =>
        drainEventsSince(runId, cursor, fetchEventsAfter, writeEvent),
      );

      // The reference backend is woken by Postgres NOTIFY; we poll the same
      // cursor. Either way the FIRST pass has to happen unprompted: an event
      // written between the snapshot read above and this line would otherwise
      // never be delivered, and if it was the terminal one the stream would
      // hang in "running" forever.
      void drainer.notify();

      const startedAt = Date.now();
      const poll = setInterval(() => {
        if (drainer.done || closed) return;
        void drainer.notify();
      }, POLL_MS);

      // Keepalive — proxies close idle SSE connections.
      const heartbeat = setInterval(() => {
        if (drainer.done || closed) return;
        try {
          send('', 'heartbeat');
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      const finish = setInterval(() => {
        if (drainer.done || Date.now() - startedAt > MAX_STREAM_MS) cleanup();
      }, POLL_MS);

      function cleanup() {
        drainer.stop();
        clearInterval(poll);
        clearInterval(heartbeat);
        clearInterval(finish);
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Beta sits behind nginx. Without this, nginx buffers the whole stream
      // into its proxy buffers and flushes at close — turning live progress
      // into one burst at the end, which looks exactly like the feature not
      // working. This project has already been bitten by those buffers once
      // (the chunked-cookie 502), so it is not hypothetical.
      'X-Accel-Buffering': 'no',
    },
  });
}

function eventTypeToStatus(type: string): string | undefined {
  switch (type) {
    case 'execution_completed':
      return 'completed';
    case 'execution_incomplete':
      return 'incomplete';
    case 'execution_failed':
      return 'failed';
    case 'execution_cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}
