import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

// H3 — Voximplant stuck-row reconciler (worker/main.ts, every 10m). ALERT-ONLY:
// counts call_attempts rows still in a pre-terminal status
// ('queued'/'dialing'/'in_progress' — exactly the partial call_attempts_stale_idx
// set) whose created_at is older than 15 minutes, and Slack-alerts so a human can
// investigate/close them.
//
// It NEVER re-issues StartScenarios and NEVER mutates a row — a redial from an
// automated reconciler risks double-calling a guest whose original attempt is
// merely mid-flight or whose result callback is delayed. The safe MVP is to
// surface the anomaly (ids/counts only, no PII) and let an operator resolve it.
//
// Fail-safe: read-only; a query error / empty set is a silent no-op; the Slack
// send is fire-and-forget (never throws, bounded timeout) so it can never fail
// the pg-boss tick.
export async function runCallReconcile(): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15m pre-terminal = stuck
  const { data, error } = await admin
    .from('call_attempts')
    .select('id')
    .in('status', ['queued', 'dialing', 'in_progress'])
    .lt('created_at', cutoff);
  if (error || !data || data.length === 0) return;

  void sendSlackAlert({
    level: 'warn',
    category: 'send_health',
    source: 'voximplant-reconcile',
    title: 'Voximplant stuck call attempts',
    detail: `${data.length} pre-terminal rows older than 15m`,
    // ids/counts only — NEVER re-issue StartScenarios from here.
    fields: { stuck: data.length },
  });
}
