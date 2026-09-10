// Deliberately dependency-free (no 'server-only', no Supabase client) so
// summary.ts — documented as "pure, side-effect-free... trivially testable"
// — can import this VALUE without transitively pulling in a server-only
// marker via db-health.ts and failing under vitest's plain Node runtime.

// Queues that ARE scheduled but have no boss.schedule() equivalent expected
// interval hardcoded elsewhere — mirrors the exact cron catalog in
// worker/main.ts (verified 31.07). Used by the Jobs panel to color-code
// staleness; queues absent from this map are event-driven
// (outreach-step / outreach-call-request / outreach-dead) and are never
// flagged stale regardless of how long ago they last completed.
export const QUEUE_EXPECTED_MAX_MINUTES: Record<string, number> = {
  'outreach-arm': 3,
  'webhook-process': 3,
  'outreach-sweeper': 15,
  'campaign-thankyou-sweep': 15,
  'call-callback-sweep': 15,
  'callback-calendar-schedule-sweep': 30,
  'voximplant-call-reconcile': 30,
  'voximplant-callback-dispatch-reconcile': 30,
  'voximplant-sales-dispatch-reconcile': 30,
  'voximplant-balance-check': 90,
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
  'voximplant-log-export': 3 * 24 * 60,
  'call-dispatch-retention': 3 * 24 * 60,
  'auth-phone-change-cleanup': 3 * 24 * 60,
  // Weekly (Monday 09:00 IL): flag only after a whole missed week plus slack.
  'seo-technical-watch': 10 * 24 * 60,
  // Weekly (Sunday 05:20 IL). Same 10-day allowance as the other weekly job:
  // a missed CLI upgrade is not urgent, but a job that silently stopped running
  // means the toolchain quietly rots, which is exactly what this watches for.
  'supabase-cli-update': 10 * 24 * 60,
};
