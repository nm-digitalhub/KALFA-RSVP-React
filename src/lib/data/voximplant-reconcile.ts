import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

// H3 — Voximplant stuck-row reconciler (worker/main.ts, every 10m). ALERT-ONLY:
// finds call_attempts rows still in a pre-terminal status
// ('queued'/'dialing'/'in_progress' — exactly the partial call_attempts_stale_idx
// set) whose created_at is older than 15 minutes, and Slack-alerts so a human can
// investigate/close them.
//
// It NEVER re-issues StartScenarios and NEVER mutates a row — a redial from an
// automated reconciler risks double-calling a guest whose original attempt is
// merely mid-flight or whose result callback is delayed. The safe MVP is to
// surface the anomaly (ids/counts only, no PII) and let an operator resolve it.
//
// ALERT CADENCE — edge-triggered on the stuck SET, not on the tick: a stuck row
// can persist for days (2026-07-19: one leftover test row produced an @mentioned
// Slack message every 10m for four days — slack.ts's 60s dedup window is no
// brake against a 10m schedule). Send immediately when the set of stuck ids
// CHANGES (new row stuck / partial resolve), re-send only every
// REALERT_INTERVAL_MS while the same set persists, and reset once the set fully
// clears so the next incident alerts at once. Per-process state — a worker
// restart (deploy) re-alerts once, acceptable for ops.
//
// Fail-safe: read-only; a query error is a silent no-op that KEEPS the previous
// alert state (unknown ≠ resolved); the Slack send is fire-and-forget (never
// throws, bounded timeout) so it can never fail the pg-boss tick.

// Reminder cadence while the SAME stuck set persists unresolved.
const REALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Cap the ids listed in the alert — `stuck` still counts the full set.
const MAX_IDS_IN_ALERT = 5;

let lastAlertedSetKey = '';
let lastAlertedAt = 0;

export function __resetCallReconcileStateForTests(): void {
  lastAlertedSetKey = '';
  lastAlertedAt = 0;
}

export async function runCallReconcile(): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15m pre-terminal = stuck
  const { data, error } = await admin
    .from('call_attempts')
    .select('id')
    .in('status', ['queued', 'dialing', 'in_progress'])
    .lt('created_at', cutoff);
  if (error || !data) return;
  if (data.length === 0) {
    // Resolved — the next stuck row is a NEW incident and must alert at once.
    lastAlertedSetKey = '';
    lastAlertedAt = 0;
    return;
  }

  const ids = data.map((row) => row.id).sort();
  const setKey = ids.join(',');
  const now = Date.now();
  if (setKey === lastAlertedSetKey && now - lastAlertedAt < REALERT_INTERVAL_MS) return;
  lastAlertedSetKey = setKey;
  lastAlertedAt = now;

  const shownIds =
    ids.slice(0, MAX_IDS_IN_ALERT).join(', ') + (ids.length > MAX_IDS_IN_ALERT ? ' …' : '');
  void sendSlackAlert({
    level: 'warn',
    category: 'send_health',
    source: 'voximplant-reconcile',
    title: 'Voximplant stuck call attempts',
    detail: `${ids.length} pre-terminal rows older than 15m`,
    // ids/counts only — NEVER re-issue StartScenarios from here.
    fields: { stuck: ids.length, ids: shownIds },
  });
}
