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

import { QUEUES, type OutreachStepJob } from '@/lib/queue/queues';
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

type StepJob = { id: string; data: OutreachStepJob };

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
  boss.on('error', (e: Error) => console.error('[pgboss]', e.message));
  await boss.start();

  for (const q of Object.values(QUEUES)) {
    await boss.createQueue(q);
  }

  await boss.work(QUEUES.step, async (jobs: StepJob[]) => {
    for (const job of jobs) await handleStep(boss, job);
  });
  await boss.work(QUEUES.dead, async (jobs: { data: OutreachStepJob }[]) => {
    for (const job of jobs) await handleDead(job);
  });
  await boss.work(QUEUES.arm, async () => {
    await handleArm(boss);
  });
  await boss.work(QUEUES.sweeper, async () => {
    await handleArm(boss);
  });
  await boss.work(QUEUES.webhook, async () => {
    await handleWebhook();
  });

  await boss.schedule(QUEUES.arm, '* * * * *');
  await boss.schedule(QUEUES.sweeper, '*/5 * * * *');
  await boss.schedule(QUEUES.webhook, '* * * * *');

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

main().catch((e) => {
  console.error('[kalfa-worker] fatal', e);
  process.exit(1);
});
