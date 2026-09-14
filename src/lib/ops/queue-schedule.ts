// Deliberately dependency-free (no 'server-only', no Supabase client) so
// summary.ts — documented as "pure, side-effect-free... trivially testable"
// — can import this VALUE without transitively pulling in a server-only
// marker via db-health.ts and failing under vitest's plain Node runtime.

// Queues that ARE scheduled but have no boss.schedule() equivalent expected
// interval hardcoded elsewhere — mirrors the exact cron catalog in
// worker/main.ts. Used by the Jobs panel to color-code staleness; queues absent
// from this map are event-driven (outreach-step / outreach-call-request /
// outreach-dead) and are never flagged stale regardless of how long ago they
// last completed.
//
// ⚠️ "MIRRORS" IS NOW ENFORCED, BECAUSE IT STOPPED BEING TRUE.
// This comment used to end "(verified 31.07)" — a date, which is what a
// hand-maintained mirror degrades into. MEASURED 2026-09-13: the worker
// scheduled 32 queues and this map named 20 of them. The missing twelve were not
// obscure — they included whatsapp-template-health-sync, the nightly reconciliation
// against Meta, and graph-intake-subscription-renew, whose stall silently ends
// inbound mail intake. `isQueueStale` returns FALSE for anything absent here, so
// each of those could have stopped running and the Debug badge would have stayed
// green forever. Nothing was broken; nothing could have been noticed if it were.
//
// queue-schedule.test.ts now reads worker/main.ts and fails if the two sets
// diverge in either direction, so entry 33 is a test failure rather than a
// silently unmonitored job.
//
// THE ALLOWANCES ARE ~3x THE JOB'S OWN INTERVAL, rounded to the family it belongs
// to. Three missed runs is late; one is a blip, and a badge that goes red on a
// blip stops being read.
export const QUEUE_EXPECTED_MAX_MINUTES: Record<string, number> = {
  // Every minute.
  'outreach-arm': 3,
  'webhook-process': 3,
  'workflow-schedule-sweep': 3,
  // Every 5 minutes.
  'outreach-sweeper': 15,
  'campaign-thankyou-sweep': 15,
  'call-callback-sweep': 15,
  'inquiry-followup-sweep': 15,
  // Every 10 minutes.
  'callback-calendar-schedule-sweep': 30,
  'voximplant-call-reconcile': 30,
  'voximplant-callback-dispatch-reconcile': 30,
  'voximplant-sales-dispatch-reconcile': 30,
  'console-agent-calendar-presence-sync': 30,
  'fleet-request-expire-sweep': 30,
  // Every 30 minutes.
  'voximplant-balance-check': 90,
  'sumit-hold-reconcile': 90,
  // Runs hourly; flagged only after four missed runs, because a Meta blip should
  // not turn the badge red on its own.
  'whatsapp-health-check': 4 * 60,
  // Hourly, same allowance and same reason: a provider blip should not turn the
  // badge red on its own.
  'email-health-check': 4 * 60,
  // Daily/6h jobs, Asia/Jerusalem — 3x their own interval is measured in
  // hours/days, not minutes; wide multiples avoid false "stale" from a job
  // that simply hasn't reached its next scheduled tick yet.
  'elevenlabs-quota-check': 18 * 60,
  // Every 6 hours. Three missed runs is 18 hours, and the subscription it renews
  // lives ~2.94 days — so the badge turns red with well over a day of margin
  // before inbound intake could actually lapse.
  'graph-intake-subscription-renew': 18 * 60,
  // Daily. Same 3x-ish allowance as its neighbours — a daily job flagged after four
  // hours is "stale" by breakfast every single day.
  'extra-key-check': 3 * 24 * 60,
  'sumit-health-check': 3 * 24 * 60,
  'voximplant-log-export': 3 * 24 * 60,
  'call-dispatch-retention': 3 * 24 * 60,
  'auth-phone-change-cleanup': 3 * 24 * 60,
  'whatsapp-template-health-sync': 3 * 24 * 60,
  'agreement-archive-sweep': 3 * 24 * 60,
  'signup-reminder-sweep': 3 * 24 * 60,
  'unconfirmed-cleanup-sweep': 3 * 24 * 60,
  // Weekly (Monday 09:00 IL): flag only after a whole missed week plus slack.
  'seo-technical-watch': 10 * 24 * 60,
  // Weekly (Sunday 05:20 IL). Same 10-day allowance as the other weekly job:
  // a missed CLI upgrade is not urgent, but a job that silently stopped running
  // means the toolchain quietly rots, which is exactly what this watches for.
  'supabase-cli-update': 10 * 24 * 60,
  // Weekly (Sunday 04:10 IL) — the archive fixity check.
  'archive-maintenance-sweep': 10 * 24 * 60,
  // Weekly (Tuesday 04:17 IL). The token it refreshes lasts 60 days, so a late
  // run is not urgent — but a run that stopped happening is exactly how a
  // 60-day token expires unnoticed.
  'instagram-token-refresh': 10 * 24 * 60,
  // MONTHLY (1st at 04:40 IL) — the only job on this cadence, and the reason the
  // allowance is not another multiple: 3x a month is a quarter. 40 days clears the
  // longest month plus slack, so one missed snapshot shows up inside six weeks.
  'archive-backup-sweep': 40 * 24 * 60,
};
