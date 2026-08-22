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
  // Daily/6h jobs, Asia/Jerusalem — 3x their own interval is measured in
  // hours/days, not minutes; wide multiples avoid false "stale" from a job
  // that simply hasn't reached its next scheduled tick yet.
  'elevenlabs-quota-check': 18 * 60,
  'voximplant-log-export': 3 * 24 * 60,
  'call-dispatch-retention': 3 * 24 * 60,
};
