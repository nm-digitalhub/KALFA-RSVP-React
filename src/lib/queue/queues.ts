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
  // Callback re-dial sweep — same cron idiom: a tick that reads fresh DB state
  // and enqueues a callRequest for every callback that has come due. It exists
  // because schedule_callback only ever RECORDED the guest's request; nothing
  // dialled. Gates stay in dispatchOutreachCall; this only enqueues.
  // See src/lib/data/call-callbacks.ts.
  callbackSweep: 'call-callback-sweep',
  // Voximplant balance-alert cron (H2) — every 30m poll GetAccountInfo and Slack
  // when balance dips below reserve/low-threshold. Read-only; never dials. Inert
  // while VOXIMPLANT_LIVE_CALLS is off. See src/lib/data/voximplant-balance.ts.
  balanceCheck: 'voximplant-balance-check',
  // Voximplant stuck-row reconciler (H3) — every 10m alert (ONLY) on pre-terminal
  // call_attempts older than 15m. NEVER re-issues StartScenarios. See
  // src/lib/data/voximplant-reconcile.ts.
  callReconcile: 'voximplant-call-reconcile',
  // Voximplant session-log export (A4) — daily; downloads logs (which expire
  // ~1 month) into the private vox-call-logs bucket. Singleton so a manual run
  // never overlaps the cron (an atomic per-row lease is the inner guard). See
  // src/lib/data/vox-log-export.ts.
  logExport: 'voximplant-log-export',
  // ElevenLabs character-quota alert (item 3) — every 6h read /v1/user/
  // subscription and Slack at ≥80% (warn) / ≥95% (error). Config-gated (no key
  // → no-op), read-only, never throws. See src/lib/data/elevenlabs-quota.ts.
  elevenlabsQuota: 'elevenlabs-quota-check',
  // call_dispatch_status retention — daily delete of rows older than 30 days.
  // The table is a status channel, not an audit log (activity_log keeps the
  // durable record); this also clears version-skew stragglers. See
  // src/lib/data/call-dispatch-status.ts.
  dispatchRetention: 'call-dispatch-retention',
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
  /**
   * This dial fulfils a callback the guest asked for during an earlier call
   * (schedule_callback), not a new campaign touchpoint.
   *
   * It exempts the dial from the already-reached gate and NOTHING else —
   * consent, DNC and the event-closed gate are still enforced. Owner decision,
   * 2026-07-21: a callback is the SAME billable reach continuing, not a second
   * one. The contact was already billed when they first answered, and finishing
   * the conversation they asked to postpone must not charge for them twice.
   *
   * Absent/false on every ordinary campaign job, so the gate keeps its current
   * behaviour by default.
   */
  isCallback?: boolean;
  /** The attempt that requested the callback — for tracing the re-dial back. */
  callbackFromAttemptId?: string;
  /**
   * An operator pressed "call this guest" in the console. Two effects, both
   * narrow: the touchpoint index is allocated from the reserved manual band
   * (atomically, see nextManualTouchpoint), and the outcome is written to the
   * event's activity log so a refusal is visible to the owner rather than
   * living only in a worker log line.
   *
   * It does NOT exempt any gate. A manual dial is a new reach; unlike
   * isCallback, nothing here bypasses already-reached.
   */
  isManual?: boolean;
  /**
   * The enqueue job id handed to the console at 202, stamped onto the attempt
   * row so the caller can poll for a row that did not exist when it was
   * answered.
   */
  dispatchId?: string;
};
