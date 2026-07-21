// KALFA outreach worker — the long-lived pg-boss process (pm2 `kalfa-worker`).
// Drives the §10 schedule across contacts with the §12 FINAL serial flow:
// cursor-first evaluate → reserve → send → resolve, one step at a time, at most
// once. The web tier stays pg-boss-free; this process owns all send/work/
// schedule. Inert until outreach_enabled is on (stepGate + the arm fail-close),
// so it is safe to run before go-live.
//
// Built with esbuild → dist/worker.cjs (server-only / next/headers / next/cache
// aliased to an empty stub; node_modules kept external). Run: node dist/worker.cjs.

import fs from 'node:fs';
import path from 'node:path';
import { PgBoss } from 'pg-boss';

import { QUEUES, type OutreachCallRequest, type OutreachStepJob } from '@/lib/queue/queues';
import { dispatchOutreachCall } from '@/lib/data/outreach-calls';
import {
  listActiveCampaigns,
  listActiveOutreach,
  getCampaignContext,
  seedOutreachState,
  stepGate,
  setOutreachStatus,
  loadOutreachRow,
  ensureCurrentStep,
  prepareAndSendStep,
  checkStepTerminal,
  reserveStep,
  releaseReservation,
  resolveStep,
  type CampaignContext,
} from '@/lib/data/outreach-engine';
import {
  runStepExecution,
  type StepExecutionDeps,
} from '@/lib/outreach/enqueue';
import { detId, deferId, stepPlanRev, stepAuditId } from '@/lib/outreach/schedule';
import { evaluateStep } from '@/lib/outreach/send-window';
import { getOutreachEnabled, getSendPolicy } from '@/lib/data/outreach-config';
import { buildJewishCalendar } from '@/lib/outreach/jewish-calendar';
import { getJobRetryMeta, closeJobMetaPool } from './pgboss-meta';
import {
  claimUnprocessedWebhookEvents,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from '@/lib/data/webhooks';
import { processWebhookEvent } from '@/lib/data/webhook-processing';
import { runThankyouSweep } from '@/lib/data/auto-thankyou';
import { runBalanceCheck } from '@/lib/data/voximplant-balance';
import { runCallReconcile } from '@/lib/data/voximplant-reconcile';
import { runLogExport } from '@/lib/data/vox-log-export';
import { runElevenLabsQuotaCheck } from '@/lib/data/elevenlabs-quota';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Standalone process — load .env.local ourselves (Next is not running here).
function loadEnv(): void {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

const DAY_MS = 86_400_000;

// Timezone for the crons anchored to a wall-clock hour (log-export at 03:20,
// quota-check at 0/6/12/18). pg-boss defaults schedules to UTC; KALFA operates in
// Israel, so those run on Israel local time (DST-aware via the IANA zone). The
// interval crons (*/N) are timezone-independent and left as-is.
const SCHEDULE_TZ = 'Asia/Jerusalem';

type StepJob = { id: string; data: OutreachStepJob };
type CallJob = { id: string; data: OutreachCallRequest };

// Outbound AI-call dispatch (C2). dispatchOutreachCall is fully fail-safe: only a
// pre-dial balance-check transport failure is retryable — every other outcome
// (blocked/skipped/ambiguous start_unknown/definite failed_to_start/reconciled)
// COMPLETES the job so a retry can never place a second call. We throw ONLY on
// that transient kind (guardedWorker then Slack-alerts + pg-boss retries per
// CALL_RETRY). Log ids + kind only — never PII.
async function handleCallRequest(job: CallJob): Promise<void> {
  const result = await dispatchOutreachCall(job.data);
  if (result.kind === 'transient_error') {
    throw new Error(`voximplant balance check failed: ${result.reason}`);
  }
  console.log('[kalfa-worker] call-request resolved', {
    jobId: job.id,
    contactId: job.data.contactId,
    kind: result.kind,
    // The reason, not just the kind: 'skipped' spans consent, DNC, caps and a
    // closed event, and without this a gate that correctly stops every call in a
    // campaign is indistinguishable from one that is broken. All values are
    // fixed enum strings — no PII.
    ...('reason' in result ? { reason: result.reason } : {}),
  });
}

// Wrap a pg-boss work handler so a thrown failure fires a fail-safe ops alert
// and is then RE-THROWN — pg-boss must still see the failure for its retry /
// dead-letter machinery. sendSlackAlert never throws, so it cannot corrupt the
// job outcome. NO PII: only the queue name + the Error message (code errors,
// never guest data).
function guardedWorker<T>(
  queue: string,
  handler: (jobs: T) => Promise<void>,
): (jobs: T) => Promise<void> {
  return async (jobs: T) => {
    try {
      await handler(jobs);
    } catch (e) {
      await sendSlackAlert({
        level: 'error',
        title: `worker job failed: ${queue}`,
        detail: e instanceof Error ? e.message : 'unknown error',
        source: queue,
        category: 'errors',
      });
      throw e;
    }
  };
}

// The injected side effects for one step's execution (§12 FINAL): the RPC
// wrappers + the WhatsApp/call send + the worker-only pg-boss retry adapter.
function buildExecutionDeps(
  boss: PgBoss,
  ctx: CampaignContext,
  campaignId: string,
  contactId: string,
  eventId: string,
  stepIndex: number,
  planRev: string,
): StepExecutionDeps {
  return {
    reserve: (a) => reserveStep(a),
    send: () => prepareAndSendStep(boss, ctx, campaignId, contactId, eventId, stepIndex),
    resolve: (a) => resolveStep(a),
    release: (a) => releaseReservation(a),
    getRetryMeta: (jobId) =>
      getJobRetryMeta({ schema: 'pgboss', queueName: QUEUES.step, jobId }),
    auditId: (reason) => stepAuditId(campaignId, contactId, stepIndex, planRev, reason),
    recheckTerminal: () => checkStepTerminal(ctx, contactId, stepIndex),
  };
}

async function handleStep(boss: PgBoss, job: StepJob): Promise<void> {
  const data = job.data;
  const { campaignId, contactId, eventId } = data;
  const gate = await stepGate(campaignId, contactId, eventId);

  // Pause-poll job (§F.6): id-less, NOT an execution job — it never reserves or
  // sends. It idles while paused and, on resume, re-arms via deferId.
  if (data.poll) {
    if (gate.reason === 'paused') {
      await boss.send(QUEUES.step, { ...data, poll: true }, { startAfter: 300 });
      return;
    }
    if (gate.reason === 'stopped') {
      await setOutreachStatus(campaignId, contactId, 'stopped', 'closed');
      return;
    }
    if (gate.reason === 'reached' || !gate.ctx) {
      await setOutreachStatus(campaignId, contactId, 'reached', 'reached');
      return;
    }
    await ensureCurrentStep(boss, campaignId, contactId, 'defer');
    return;
  }

  // Normal execution job.
  if (gate.reason === 'paused') {
    // Convert to an id-less re-poll; THIS (detId/deferId) job now completes.
    // Because the deterministic job may reach 'completed', resume MUST route
    // around it via deferId — which the poll's ensureCurrentStep(mode:'defer') does.
    await boss.send(QUEUES.step, { ...data, poll: true }, { startAfter: 300 });
    return;
  }
  if (gate.reason === 'stopped') {
    await setOutreachStatus(campaignId, contactId, 'stopped', 'closed');
    return;
  }
  if (gate.reason === 'reached' || !gate.ctx) {
    await setOutreachStatus(campaignId, contactId, 'reached', 'reached');
    return;
  }
  const ctx = gate.ctx;

  // CURSOR-FIRST: this job is valid only if it targets the CURRENT cursor, the
  // CURRENT planRev, and carries the matching deterministic id. Any mismatch is a
  // stale job (a superseded plan / a moved cursor) → drop it.
  const row = await loadOutreachRow(campaignId, contactId);
  if (!row || row.status !== 'active') return;
  const cursor = row.current_step_index;
  if (data.stepIndex !== cursor) return;
  if (cursor >= ctx.schedule.length) {
    await setOutreachStatus(campaignId, contactId, 'exhausted');
    return;
  }

  const policy = await getSendPolicy();
  const tp = ctx.schedule[cursor];
  const currentPlanRev = stepPlanRev(ctx.eventDate, tp, policy);
  if (data.planRev !== currentPlanRev) {
    // The plan changed under this job → re-arm the cursor under the new plan.
    await ensureCurrentStep(boss, campaignId, contactId, 'replan');
    return;
  }
  const expectedId =
    data.mode === 'defer'
      ? deferId(campaignId, contactId, cursor, data.planRev, Math.round(data.targetSlotMs))
      : detId(campaignId, contactId, cursor, data.planRev);
  if (job.id !== expectedId) return;

  const nowMs = Date.now();
  const cal = buildJewishCalendar(nowMs - DAY_MS, Date.parse(ctx.eventDate) + DAY_MS);
  const decision = evaluateStep({
    schedule: ctx.schedule,
    cursorIndex: cursor,
    eventDateIso: ctx.eventDate,
    nowMs,
    policy,
    calendar: cal,
    campaignId,
    contactId,
  });

  if (decision.decision === 'defer') {
    // The legal slot moved forward → re-plan the same cursor (new slot + deferId).
    await ensureCurrentStep(boss, campaignId, contactId, 'defer');
    return;
  }
  if (decision.decision === 'skip' || decision.decision === 'terminal') {
    // Advance/terminalize with an audit, then walk to the next schedulable step.
    await ensureCurrentStep(boss, campaignId, contactId, 'plan');
    return;
  }

  // SEND → reserve → send → resolve (or crash-recovery if we already own it).
  const plannedAtIso = new Date(Math.round(data.targetSlotMs)).toISOString();
  await runStepExecution(
    buildExecutionDeps(boss, ctx, campaignId, contactId, eventId, cursor, data.planRev),
    {
      campaignId,
      contactId,
      eventId,
      stepIndex: cursor,
      planRev: data.planRev,
      plannedAtIso,
      jobId: job.id,
      alreadyReserved: row.dispatched_job_id === job.id,
    },
  );
}

// Dead-letter (§F.7): telemetry + chain CONTINUITY only, NO business recovery.
// Recompute the source execution id from the payload and classify by LIVE state.
async function handleDead(job: { data: OutreachStepJob }): Promise<void> {
  const data = job.data;
  const { campaignId, contactId, eventId } = data;
  const row = await loadOutreachRow(campaignId, contactId);
  if (!row || row.status !== 'active') return;

  const sourceId =
    data.mode === 'defer'
      ? deferId(campaignId, contactId, data.stepIndex, data.planRev, Math.round(data.targetSlotMs))
      : detId(campaignId, contactId, data.stepIndex, data.planRev);

  if (row.dispatched_job_id === sourceId) {
    // The reserved job died — a send MAY have occurred. Fail-closed: telemetry
    // only, no advance, no resend (at-most-once). No PII.
    console.warn('[kalfa-worker] dead-letter: reserved job died, no advance', {
      campaignId,
      contactId,
      stepIndex: data.stepIndex,
    });
    // Fail-safe ops alert — ids only, no PII, no delivery recovery here.
    await sendSlackAlert({
      level: 'warn',
      title: 'worker dead-letter: reserved job died',
      source: 'dead-letter',
      fields: { campaignId, contactId, stepIndex: data.stepIndex },
      category: 'errors',
    });
    return;
  }
  if (row.dispatched_job_id !== null) return; // a different job owns it → stale.
  if (row.current_step_index !== data.stepIndex) return; // cursor moved → stale.

  // No reservation and the cursor still matches → advance-skip{internal_fault}
  // for chain continuity (NOT a delivery guarantee). The RPC's plan_rev + cursor
  // guards make a mismatch a no-op ('stale').
  await resolveStep({
    campaignId,
    contactId,
    stepIndex: data.stepIndex,
    planRev: data.planRev,
    jobId: null,
    advance: true,
    terminalStatus: null,
    reason: 'internal_fault',
    eventId,
    auditId: stepAuditId(campaignId, contactId, data.stepIndex, data.planRev, 'internal_fault'),
  });
}

// Drain webhook_inbox: claim the oldest unprocessed rows and run the economic
// logic out-of-band. Each row is independent — a failure on one bumps its attempt
// counter (and keeps last_error) without blocking the rest; the DB-level dedupe
// + recordReached gating make re-processing safe. Never log a payload.
async function handleWebhook(): Promise<void> {
  const rows = await claimUnprocessedWebhookEvents(50);
  for (const row of rows) {
    try {
      await processWebhookEvent(row);
      await markWebhookEventProcessed(row.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown error';
      await markWebhookEventFailed(row.id, row.attempts + 1, message);
      // Fail-safe ops alert — row id + attempts only (the message may echo
      // provider payload text, so it is deliberately NOT included).
      await sendSlackAlert({
        level: 'warn',
        title: 'webhook processing failed',
        source: 'webhook-processing',
        fields: { rowId: row.id, attempts: row.attempts + 1 },
        category: 'errors',
      });
    }
  }
}

// Arm/sweep: for each active contact, drive the CURRENT cursor step through the
// single evaluator (idempotent — anchor CAS + deterministic ids). This IS the
// self-heal (re-enqueues the cursor, walks past superseded touchpoints). Inert
// while the global emergency stop is engaged.
async function handleArm(boss: PgBoss): Promise<void> {
  if (!(await getOutreachEnabled())) return;
  for (const camp of await listActiveCampaigns()) {
    const ctx = await getCampaignContext(camp.id);
    if (!ctx || ctx.schedule.length === 0) continue;
    // Seed the cursor from the frozen authorized set (idempotent) — the single,
    // self-healing seeding path. Activation only flips status; the arm seeds.
    await seedOutreachState(camp.event_id, camp.id);
    for (const row of await listActiveOutreach(camp.id)) {
      await ensureCurrentStep(boss, camp.id, row.contact_id, 'plan');
    }
  }
}

// Auto-thankyou sweep: same periodic-tick idiom as handleArm above, not a
// per-campaign delayed job — runThankyouSweep re-reads eligibility (opt-in +
// scheduled-at + campaign/event status) from the DB on every tick, so an
// owner's toggle/reschedule just takes effect on the next 5-minute pass; there
// is nothing pg-boss-side to register or cancel. Gated by the same master
// outreach_enabled switch as the drip engine (sendCampaignWhatsApp re-checks
// it anyway — this just skips the DB scan while outreach is globally off).
async function handleThankyouSweep(): Promise<void> {
  if (!(await getOutreachEnabled())) return;
  await runThankyouSweep();
}

async function main(): Promise<void> {
  const boss = new PgBoss({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    schema: 'pgboss',
    application_name: 'kalfa-worker',
    max: 4,
    // Both off by default in pg-boss; required for the ops dashboard's
    // metrics-history/sparklines (queue_stats, 7-day retention) and
    // Warning History tabs to populate.
    persistQueueStats: true,
    persistWarnings: true,
  });
  boss.on('error', (e: Error) => {
    console.error('[pgboss]', e.message);
    // Fire-and-forget (the listener is sync); sendSlackAlert never throws.
    void sendSlackAlert({
      level: 'error',
      title: 'pg-boss error',
      detail: e.message,
      source: 'pgboss',
      category: 'errors',
    });
  });
  await boss.start();

  for (const q of Object.values(QUEUES)) {
    // thankyouSweep: 'singleton' policy — only 1 job may be ACTIVE at a time
    // (unlimited queued). Bug fix (thankyou-review, high): without this, an
    // overlapping cron tick (the previous sweep still running past the
    // 5-minute interval) could run concurrently with a new one — two
    // processes both reading "not yet claimed" for the same contact before
    // either writes a claim row. The atomic claim (contact_interactions
    // partial UNIQUE index) already makes a double-SEND impossible even under
    // overlap, but this closes the race at its source instead of relying on
    // a single defense layer.
    const singleton = q === QUEUES.thankyouSweep || q === QUEUES.logExport;
    await boss.createQueue(q, singleton ? { policy: 'singleton' } : undefined);
  }

  await boss.work(
    QUEUES.step,
    guardedWorker(QUEUES.step, async (jobs: StepJob[]) => {
      for (const job of jobs) await handleStep(boss, job);
    }),
  );
  await boss.work(
    QUEUES.dead,
    guardedWorker(QUEUES.dead, async (jobs: { data: OutreachStepJob }[]) => {
      for (const job of jobs) await handleDead(job);
    }),
  );
  await boss.work(
    QUEUES.arm,
    guardedWorker(QUEUES.arm, async () => {
      await handleArm(boss);
    }),
  );
  await boss.work(
    QUEUES.sweeper,
    guardedWorker(QUEUES.sweeper, async () => {
      await handleArm(boss);
    }),
  );
  await boss.work(
    QUEUES.callRequest,
    guardedWorker(QUEUES.callRequest, async (jobs: CallJob[]) => {
      for (const job of jobs) await handleCallRequest(job);
    }),
  );
  await boss.work(
    QUEUES.webhook,
    guardedWorker(QUEUES.webhook, async () => {
      await handleWebhook();
    }),
  );
  await boss.work(
    QUEUES.thankyouSweep,
    guardedWorker(QUEUES.thankyouSweep, async () => {
      await handleThankyouSweep();
    }),
  );
  // Voximplant balance-alert cron (H2): read-only GetAccountInfo poll — Slack when
  // the account balance dips below reserve/low-threshold. runBalanceCheck is
  // internally dark-safe (no-op while VOXIMPLANT_LIVE_CALLS is off) and never
  // throws/dials, so no extra gate is needed here.
  await boss.work(
    QUEUES.balanceCheck,
    guardedWorker(QUEUES.balanceCheck, async () => {
      await runBalanceCheck();
    }),
  );
  // Voximplant stuck-row reconciler (H3): ALERT-ONLY — surfaces pre-terminal
  // call_attempts older than 15m. NEVER re-issues StartScenarios.
  await boss.work(
    QUEUES.callReconcile,
    guardedWorker(QUEUES.callReconcile, async () => {
      await runCallReconcile();
    }),
  );
  // Voximplant session-log export (A4): daily — downloads logs (which expire
  // ~1 month) into the private bucket. runLogExport is dark-safe (no-op when the
  // channel is unconfigured), never throws, and never dials; the singleton queue
  // policy plus an atomic per-row lease prevent double-processing.
  await boss.work(
    QUEUES.logExport,
    guardedWorker(QUEUES.logExport, async () => {
      await runLogExport();
    }),
  );
  // ElevenLabs character-quota alert (item 3): every 6h read /v1/user/
  // subscription and Slack at ≥80%/≥95%. runElevenLabsQuotaCheck is dark-safe
  // (no-op when no ElevenLabs key is configured), read-only, and never throws.
  await boss.work(
    QUEUES.elevenlabsQuota,
    guardedWorker(QUEUES.elevenlabsQuota, async () => {
      await runElevenLabsQuotaCheck();
    }),
  );

  await boss.schedule(QUEUES.arm, '* * * * *');
  await boss.schedule(QUEUES.sweeper, '*/5 * * * *');
  await boss.schedule(QUEUES.webhook, '* * * * *');
  await boss.schedule(QUEUES.thankyouSweep, '*/5 * * * *');
  await boss.schedule(QUEUES.balanceCheck, '*/30 * * * *');
  await boss.schedule(QUEUES.callReconcile, '*/10 * * * *');
  // Anchored to a wall-clock hour → run on Israel local time (DST-aware).
  await boss.schedule(QUEUES.logExport, '20 3 * * *', null, { tz: SCHEDULE_TZ });
  await boss.schedule(QUEUES.elevenlabsQuota, '0 */6 * * *', null, { tz: SCHEDULE_TZ });

  console.log('[kalfa-worker] started — queues + schedules up');

  const shutdown = async (): Promise<void> => {
    console.log('[kalfa-worker] SIGTERM — stopping gracefully');
    await boss.stop({ graceful: true, timeout: 30000 });
    await closeJobMetaPool();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(async (e) => {
  console.error('[kalfa-worker] fatal', e);
  // Best-effort fail-safe alert before exiting (awaited; never throws).
  await sendSlackAlert({
    level: 'error',
    title: 'worker fatal',
    detail: e instanceof Error ? e.message : 'unknown error',
    source: 'worker-fatal',
    category: 'errors',
  });
  process.exit(1);
});
