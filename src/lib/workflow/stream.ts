import 'server-only';

// The I/O half of the execution stream. The cursor logic lives in ./drain.ts,
// which is pure and therefore testable; this is only the query it is handed.
//
// Substituted from the reference backend: it is woken by Postgres LISTEN/NOTIFY
// over its own pg connection. We reach Postgres through PostgREST, which has no
// LISTEN, and a second direct connection from the web tier is a lot of moving
// parts for runs that finish in under a second — the SSE route polls this on the
// same cursor instead. Same order, same terminal behaviour, different latency.
import { createAdminClient } from '@/lib/supabase/admin';

import type { StreamEvent } from './execution-events';

/**
 * One run's events after a cursor, ascending.
 *
 * The same query shape serves the opening snapshot (`afterSeq = 0`) and every
 * live drain — one shape across the route, not two, so the snapshot cannot
 * disagree with what follows it.
 */
export async function fetchEventsAfter(
  runId: string,
  afterSeq: number,
  limit = 500,
): Promise<StreamEvent[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflow_run_events')
    .select('seq, type, node_id, payload, created_at')
    .eq('run_id', runId)
    .gt('seq', afterSeq)
    .order('seq', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`fetchEventsAfter failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    seq: Number(row.seq),
    type: row.type,
    ...(row.node_id ? { nodeId: row.node_id } : {}),
    payload: row.payload,
    timestamp: row.created_at,
  }));
}
