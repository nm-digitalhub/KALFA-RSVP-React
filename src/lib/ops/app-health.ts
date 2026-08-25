import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/supabase/types';
// Reads ops_errors (written by src/instrumentation.ts, independent of the
// Slack alert gates) and ops_alerts (delivery history) for the Debug page's
// app-health panel. Both RLS-restrict SELECT to the platform owner already
// (ops_errors_owner_select / ops_alerts_admin_select) — this module adds no
// authorization of its own, matching src/lib/data/admin/alerts.ts.

type OpsErrorRow = Tables<'ops_errors'>;
type OpsAlertRow = Tables<'ops_alerts'>;

export type RecentError = Pick<
  OpsErrorRow,
  'id' | 'occurred_at' | 'route_path' | 'route_type' | 'method' | 'error_name' | 'digest' | 'deploy_id'
>;

export interface AppHealthSummary {
  errorCounts: { last1h: number; last24h: number; last7d: number };
  recentErrors: RecentError[];
  recentSuppressedAlerts: number; // sum(suppressed_count) over ops_alerts, last 24h
}

const ERROR_COLUMNS =
  'id, occurred_at, route_path, route_type, method, error_name, digest, deploy_id';

export async function getAppHealthSummary(): Promise<AppHealthSummary> {
  const supabase = await createClient();
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const [count1h, count24h, count7d, recent, alerts24h] = await Promise.all([
    supabase
      .from('ops_errors')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', iso(HOUR)),
    supabase
      .from('ops_errors')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', iso(DAY)),
    supabase
      .from('ops_errors')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', iso(7 * DAY)),
    supabase
      .from('ops_errors')
      .select(ERROR_COLUMNS)
      .order('occurred_at', { ascending: false })
      .limit(20),
    supabase
      .from('ops_alerts')
      .select('suppressed_count')
      .gte('created_at', iso(DAY)),
  ]);

  const suppressedSum = ((alerts24h.data ?? []) as Pick<OpsAlertRow, 'suppressed_count'>[]).reduce(
    (sum, row) => sum + (row.suppressed_count ?? 0),
    0,
  );

  return {
    errorCounts: {
      last1h: count1h.count ?? 0,
      last24h: count24h.count ?? 0,
      last7d: count7d.count ?? 0,
    },
    recentErrors: (recent.data ?? []) as RecentError[],
    recentSuppressedAlerts: suppressedSum,
  };
}
