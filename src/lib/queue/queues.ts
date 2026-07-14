// pg-boss queue names + per-queue config (pure constants — no pg-boss import, so
// safe to reference anywhere). The worker (worker/main.ts) owns work()/schedule().
export const QUEUES = {
  arm: 'outreach-arm',
  step: 'outreach-step',
  callRequest: 'outreach-call-request',
  sweeper: 'outreach-sweeper',
  dead: 'outreach-dead',
  // Persist-then-process intake: drains webhook_inbox out-of-band (B2).
  webhook: 'webhook-process',
  // Auto-thankyou periodic sweep — same idiom as arm/sweeper: a cron-scheduled
  // tick that reads fresh DB state, not a per-campaign delayed job. See
  // src/lib/data/auto-thankyou.ts.
  thankyouSweep: 'campaign-thankyou-sweep',
  // Voximplant balance-alert cron (H2) — every 30m poll GetAccountInfo and Slack
  // when balance dips below reserve/low-threshold. Read-only; never dials. Inert
  // while VOXIMPLANT_LIVE_CALLS is off. See src/lib/data/voximplant-balance.ts.
  balanceCheck: 'voximplant-balance-check',
  // Voximplant stuck-row reconciler (H3) — every 10m alert (ONLY) on pre-terminal
  // call_attempts older than 15m. NEVER re-issues StartScenarios. See
  // src/lib/data/voximplant-reconcile.ts.
  callReconcile: 'voximplant-call-reconcile',
} as const;

// outreach-step retry policy: a few backed-off retries, then dead-letter. The
// compare-and-advance + deterministic job id make retries at-most-once-effective.
export const STEP_RETRY = {
  retryLimit: 3,
  retryBackoff: true,
  retryDelayMax: 300,
  deadLetter: QUEUES.dead,
} as const;

// outreach-call-request retry policy. Applied at boss.send() time (like
// STEP_RETRY, per enqueue.ts:53-57). Only the pre-dial GetAccountInfo transport
// check is ever retried; once StartScenarios is invoked the dispatcher never
// asks for a retry (ambiguous ⇒ start_unknown, definite ⇒ failed_to_start), so a
// retry can never place a second call. Deliberately NO `deadLetter`: QUEUES.dead's
// consumer (handleDead) hard-assumes an OutreachStepJob shape and would crash on
// a call job. guardedWorker already Slack-alerts on the final throw.
export const CALL_RETRY = {
  retryLimit: 2,
  retryBackoff: true,
  retryDelayMax: 60,
} as const;

// How a step job was enqueued (§11.2/§11.4): 'plan'/'replan' → detId, 'defer' →
// deferId. Carried in the payload for audit + successor re-enqueue; never PII.
export type OutreachStepMode = 'plan' | 'defer' | 'replan';

// The outreach-step job payload — IDs + the plan fingerprint + the enqueue mode +
// the stable target slot ONLY (never a phone/name/body). planRev is carried
// verbatim so the worker recomputes+compares it WITHOUT inferring it from the job
// id (§11.2); targetSlotMs is the deterministic slot the deferId + reserve CAS
// key on. `poll` marks the id-less pause re-poll job (§F.6): NOT an execution job
// — on resume it calls ensureCurrentStep(mode:'defer'), it never reserves/sends.
export type OutreachStepJob = {
  campaignId: string;
  contactId: string;
  eventId: string;
  stepIndex: number;
  planRev: string;
  mode: OutreachStepMode;
  targetSlotMs: number;
  poll?: boolean;
};

// The frozen payload the call channel (C2) consumes — dial ONE contact.
export type OutreachCallRequest = {
  campaignId: string;
  eventId: string;
  contactId: string;
  normalizedPhone: string;
  scriptKey: string;
  touchpointIndex: number;
};
