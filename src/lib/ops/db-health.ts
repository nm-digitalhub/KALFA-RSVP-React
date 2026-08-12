import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { SoftResult } from './agent-client';
import { QUEUE_EXPECTED_MAX_MINUTES } from './queue-schedule';

export { QUEUE_EXPECTED_MAX_MINUTES };

// Wraps the two SECURITY DEFINER RPCs added by the ops_debug_layer migration
// (ops_job_health, ops_db_health). Both are gated to the platform owner
// inside the function itself (public.is_platform_owner()) — this module adds
// no authorization of its own, matching every other admin data-layer module
// in src/lib/data/admin/.
//
// Uses the cookie-scoped client (not createAdminClient) so the RPC runs as
// the calling user and is_platform_owner()'s own auth.uid() check applies —
// the same convention alerts.ts/fleet.ts already use for their gated reads.

export interface JobHealthRow {
  queueName: string;
  isScheduled: boolean;
  cron: string | null;
  scheduleTz: string | null;
  queuedCount: number;
  activeCount: number;
  failedCount: number;
  totalCount: number;
  lastCompletedOn: string | null;
  oldestPendingOn: string | null;
}

export async function getJobHealth(): Promise<SoftResult<JobHealthRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ops_job_health');
  if (error || !data) return { ok: false, reason: error?.message ?? 'no data' };
  const rows = data.map((r) => ({
    queueName: r.queue_name,
    isScheduled: r.is_scheduled,
    cron: r.cron,
    scheduleTz: r.schedule_tz,
    queuedCount: r.queued_count,
    activeCount: r.active_count,
    failedCount: r.failed_count,
    totalCount: r.total_count,
    lastCompletedOn: r.last_completed_on,
    oldestPendingOn: r.oldest_pending_on,
  }));
  return { ok: true, data: rows };
}

export interface DbHealthRow {
  activeConnections: number;
  maxConnections: number;
  indexHitRatePct: number | null;
  tableHitRatePct: number | null;
  longestQuerySeconds: number | null;
  topQueries: Array<{ query: string; calls: number; meanExecTimeMs: number; totalExecTimeMs: number }>;
}

export async function getDbHealth(): Promise<SoftResult<DbHealthRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ops_db_health');
  if (error || !data || data.length === 0) return { ok: false, reason: error?.message ?? 'no data' };
  const row = data[0];
  return {
    ok: true,
    data: {
      activeConnections: row.active_connections,
      maxConnections: row.max_connections,
      indexHitRatePct: row.index_hit_rate_pct,
      tableHitRatePct: row.table_hit_rate_pct,
      longestQuerySeconds: row.longest_query_seconds,
      topQueries: (row.top_queries ?? []) as DbHealthRow['topQueries'],
    },
  };
}

