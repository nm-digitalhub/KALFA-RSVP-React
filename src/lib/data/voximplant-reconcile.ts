import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { DISPATCH_PRE_TERMINAL as CALLBACK_DISPATCH_PRE_TERMINAL } from '@/lib/data/callback-request-attempts';
import { DISPATCH_PRE_TERMINAL as SALES_DISPATCH_PRE_TERMINAL } from '@/lib/data/sales-call-attempts';

// H3 — Voximplant stuck-row reconciler (worker/main.ts, every 10m), extended
// 2026-08-22 to cover all three dispatch surfaces that now share this
// account's balance/concurrency ceiling (see voximplant-concurrency.ts):
// call_attempts (RSVP campaign dials), callback_request_attempts
// (meeting-confirm dials) and sales_call_attempts (sales-closing dials).
// ALERT-ONLY: finds rows still in a pre-terminal status (queued/dialing/
// in_progress for call_attempts; the equivalent dispatch_status subset for
// the other two — exactly each table's own DISPATCH_PRE_TERMINAL / partial
// stale index) whose created_at is older than 15 minutes, and Slack-alerts so
// a human can investigate/close them.
//
// It NEVER re-issues StartScenarios and NEVER mutates a row — a redial from
// an automated reconciler risks double-calling someone whose original
// attempt is merely mid-flight or whose result callback is delayed. The safe
// MVP is to surface the anomaly (ids/counts only, no PII) and let an
// operator resolve it.
//
// Kept as THREE independent reconcilers (one per table), not one query
// unioning all three: each table's row shape differs (status vs.
// dispatch_status column, different pre-terminal vocab), and — the load-
// bearing reason — each needs its OWN edge-triggered dedup state. A shared
// single stuck-set key across tables would mean a new stuck row in ANY one
// table resets the alert-suppression window for ALL of them, re-alerting on
// an unrelated table's already-acknowledged incident. See ALERT CADENCE below
// for why that matters; makeStuckAlerter gives each table its own closure.
//
// ALERT CADENCE — edge-triggered on the stuck SET, not on the tick: a stuck
// row can persist for days (2026-07-19: one leftover test row produced an
// @mentioned Slack message every 10m for four days — slack.ts's 60s dedup
// window is no brake against a 10m schedule). Send immediately when the set
// of stuck ids CHANGES (new row stuck / partial resolve), re-send only every
// REALERT_INTERVAL_MS while the same set persists, and reset once the set
// fully clears so the next incident alerts at once. Per-process state — a
// worker restart (deploy) re-alerts once, acceptable for ops.
//
// Fail-safe: read-only; a query error is a silent no-op that KEEPS the
// previous alert state (unknown ≠ resolved); the Slack send is fire-and-forget
// (never throws, bounded timeout) so it can never fail the pg-boss tick.

const STUCK_AFTER_MS = 15 * 60 * 1000;
// Reminder cadence while the SAME stuck set persists unresolved.
const REALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Cap the ids listed in the alert — `stuck` still counts the full set.
const MAX_IDS_IN_ALERT = 5;

// Pure dedup+alert logic, no Supabase types involved — kept generic so all
// three tables share it; the actual typed query per table stays a concrete,
// separately-written fetch function (see below), sidestepping the typing
// friction of a table-name-parameterized `.from()` call.
function makeStuckAlerter(opts: { source: string; title: string }) {
  let lastAlertedSetKey = '';
  let lastAlertedAt = 0;

  async function run(fetchStuckIds: () => Promise<string[] | null>): Promise<void> {
    const ids = await fetchStuckIds();
    if (ids === null) return; // query error — silent no-op, keep previous state
    if (ids.length === 0) {
      // Resolved — the next stuck row is a NEW incident and must alert at once.
      lastAlertedSetKey = '';
      lastAlertedAt = 0;
      return;
    }

    const sorted = [...ids].sort();
    const setKey = sorted.join(',');
    const now = Date.now();
    if (setKey === lastAlertedSetKey && now - lastAlertedAt < REALERT_INTERVAL_MS) return;
    lastAlertedSetKey = setKey;
    lastAlertedAt = now;

    const shownIds =
      sorted.slice(0, MAX_IDS_IN_ALERT).join(', ') +
      (sorted.length > MAX_IDS_IN_ALERT ? ' …' : '');
    void sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: opts.source,
      title: opts.title,
      detail: `${sorted.length} pre-terminal rows older than 15m`,
      // ids/counts only — NEVER re-issue StartScenarios from here.
      fields: { stuck: sorted.length, ids: shownIds },
    });
  }

  function resetForTests(): void {
    lastAlertedSetKey = '';
    lastAlertedAt = 0;
  }

  return { run, resetForTests };
}

// ── call_attempts (RSVP campaign dials) ─────────────────────────────────────

async function fetchStuckCallAttemptIds(): Promise<string[] | null> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await admin
    .from('call_attempts')
    .select('id')
    .in('status', ['queued', 'dialing', 'in_progress'])
    .lt('created_at', cutoff);
  if (error || !data) return null;
  return data.map((row) => row.id);
}

const callAlerter = makeStuckAlerter({
  source: 'voximplant-reconcile',
  title: 'Voximplant stuck call attempts',
});

export async function runCallReconcile(): Promise<void> {
  await callAlerter.run(fetchStuckCallAttemptIds);
}

export function __resetCallReconcileStateForTests(): void {
  callAlerter.resetForTests();
}

// ── callback_request_attempts (meeting-confirm dials) ───────────────────────

async function fetchStuckCallbackDispatchIds(): Promise<string[] | null> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await admin
    .from('callback_request_attempts')
    .select('id')
    .in('dispatch_status', CALLBACK_DISPATCH_PRE_TERMINAL as unknown as string[])
    .lt('created_at', cutoff);
  if (error || !data) return null;
  return data.map((row) => row.id);
}

const callbackDispatchAlerter = makeStuckAlerter({
  source: 'voximplant-reconcile-meeting-confirm',
  title: 'Voximplant stuck meeting-confirm dispatches',
});

export async function runCallbackDispatchReconcile(): Promise<void> {
  await callbackDispatchAlerter.run(fetchStuckCallbackDispatchIds);
}

export function __resetCallbackDispatchReconcileStateForTests(): void {
  callbackDispatchAlerter.resetForTests();
}

// ── sales_call_attempts (sales-closing dials) ───────────────────────────────

async function fetchStuckSalesDispatchIds(): Promise<string[] | null> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await admin
    .from('sales_call_attempts')
    .select('id')
    .in('dispatch_status', SALES_DISPATCH_PRE_TERMINAL as unknown as string[])
    .lt('created_at', cutoff);
  if (error || !data) return null;
  return data.map((row) => row.id);
}

const salesDispatchAlerter = makeStuckAlerter({
  source: 'voximplant-reconcile-sales',
  title: 'Voximplant stuck sales-closing dispatches',
});

export async function runSalesDispatchReconcile(): Promise<void> {
  await salesDispatchAlerter.run(fetchStuckSalesDispatchIds);
}

export function __resetSalesDispatchReconcileStateForTests(): void {
  salesDispatchAlerter.resetForTests();
}
