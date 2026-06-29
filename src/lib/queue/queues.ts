// pg-boss queue names + per-queue config (pure constants — no pg-boss import, so
// safe to reference anywhere). The worker (worker/main.ts) owns work()/schedule().
export const QUEUES = {
  arm: 'outreach-arm',
  step: 'outreach-step',
  callRequest: 'outreach-call-request',
  sweeper: 'outreach-sweeper',
  dead: 'outreach-dead',
} as const;

// outreach-step retry policy: a few backed-off retries, then dead-letter. The
// compare-and-advance + deterministic job id make retries at-most-once-effective.
export const STEP_RETRY = {
  retryLimit: 3,
  retryBackoff: true,
  retryDelayMax: 300,
  deadLetter: QUEUES.dead,
} as const;

// The frozen payload the call channel (C2) consumes — dial ONE contact.
export type OutreachCallRequest = {
  campaignId: string;
  eventId: string;
  contactId: string;
  normalizedPhone: string;
  scriptKey: string;
  touchpointIndex: number;
};
