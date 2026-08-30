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
import { Client as PgClient } from 'pg';

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
import { runInquiryFollowupSweep, getInquiryFollowupEnabled } from '@/lib/data/inquiry-followup';
import { runGraphIntakeSubscriptionSweep } from '@/lib/data/inquiry-mail-intake';
import { runCallbackSweep } from '@/lib/data/call-callbacks';
import { runCallbackSchedulingSweep } from '@/lib/data/callback-scheduling';
import {
  dispatchMeetingConfirmCall,
  type MeetingConfirmDispatchJob,
} from '@/lib/data/meeting-confirm-dispatch';
import {
  dispatchSalesCall,
  type SalesCallDispatchJob,
} from '@/lib/data/sales-call-dispatch';
import {
  getMeetingConfirmDispatchConfig,
  getSalesCallDispatchConfig,
} from '@/lib/data/voximplant-config';
import { getAppOrigin } from '@/lib/url';
import { recordManualDialOutcome } from '@/lib/data/call-attempts';
import {
  runDispatchRetention,
  settleDispatchFailure,
  settleManualDispatch,
} from '@/lib/data/call-dispatch-status';
import { runBalanceCheck } from '@/lib/data/voximplant-balance';
import {
  runCallReconcile,
  runCallbackDispatchReconcile,
  runSalesDispatchReconcile,
} from '@/lib/data/voximplant-reconcile';
import { runLogExport } from '@/lib/data/vox-log-export';
import { runElevenLabsQuotaCheck } from '@/lib/data/elevenlabs-quota';
import { runTemplateHealthSync } from '@/lib/data/template-health-sync';
import { runInstagramTokenRefresh } from '@/lib/data/instagram-token-refresh';
import { runConsoleAgentCalendarPresenceSync } from '@/lib/data/console-agent-calendar-presence';
import { runFleetExpireSweep } from '@/lib/fleet/expire';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Standalone process — load .env.local ourselves (Next is not running here).
//
// worker/start.mjs, the pm2 entry point, already does this BEFORE importing
// this bundle, which is the only ordering that works for modules reading
// process.env at their top level. This call is the fallback for running the
// bundle directly (`node dist/worker.cjs`) and is a cheap no-op otherwise,
// since loadEnvFile does not overwrite variables that are already set.
//
// Uses Node's built-in loader rather than the hand-rolled line parser this
// replaced: that one silently mishandled quoted values containing '=' and had
// to be kept correct by hand.
function loadEnv(): void {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  try {
    process.loadEnvFile(p);
  } catch {
    // Malformed file — the process still starts and fails loudly on the first
    // missing credential, which is more debuggable than a partial load.
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
type MeetingConfirmJob = { id: string; data: MeetingConfirmDispatchJob };
type SalesCallJob = { id: string; data: SalesCallDispatchJob };

// Outbound AI-call dispatch (C2). dispatchOutreachCall is fully fail-safe: only a
// pre-dial balance-check transport failure is retryable — every other outcome
// (blocked/skipped/ambiguous start_unknown/definite failed_to_start/reconciled)
// COMPLETES the job so a retry can never place a second call. We throw ONLY on
// that transient kind (guardedWorker then Slack-alerts + pg-boss retries per
// CALL_RETRY). Log ids + kind only — never PII.
async function handleCallRequest(job: CallJob): Promise<void> {
  const result = await dispatchOutreachCall(job.data);
  if (result.kind === 'transient_error') {
    // Not a final outcome — the dispatch row stays 'accepted' while pg-boss
    // retries. On the LAST permitted delivery (retry_count = retry_limit, same
    // adapter + semantics as the step path's definitely_not_sent decision),
    // settle failed/temporary_dispatch_failure BEFORE the rethrow so no 202
    // is left unanswered. A failed meta read degrades safely: the row stays
    // 'accepted' and the retention sweep clears it.
    if (job.data.isManual && job.data.dispatchId) {
      try {
        const meta = await getJobRetryMeta({
          schema: 'pgboss',
          queueName: QUEUES.callRequest,
          jobId: job.id,
        });
        if (meta && meta.retryCount >= meta.retryLimit) {
          await settleDispatchFailure({
            dispatchId: job.data.dispatchId,
            eventId: job.data.eventId,
            contactId: job.data.contactId,
          });
        }
      } catch (e) {
        console.error('[kalfa-worker] dispatch retry-meta read failed', {
          jobId: job.id,
          detail: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }
    throw new Error(`voximplant balance check failed: ${result.reason}`);
  }
  // An operator is waiting on this one. Two writes with OPPOSITE contracts:
  // recordManualDialOutcome (activity_log audit) is best-effort and never
  // throws; settleManualDispatch (the app's Realtime status channel keyed by
  // the dispatch_id from the 202 — call_attempts itself was never app-readable)
  // is STRICT — its failure throws, failing the job so pg-boss redelivers and
  // the answer is retried. The redelivery is dial-safe: the attempt row already
  // exists, so the dispatcher reconciles (already_dispatched) instead of
  // placing a second call. A job may therefore never complete with its
  // dispatch row stuck 'accepted'.
  if (job.data.isManual) {
    await recordManualDialOutcome({
      eventId: job.data.eventId,
      contactId: job.data.contactId,
      dispatchId: job.data.dispatchId ?? null,
      kind: result.kind,
      ...('reason' in result ? { reason: result.reason } : {}),
      ...('attemptId' in result ? { attemptId: result.attemptId } : {}),
    });
    await settleManualDispatch(job.data, result);
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

// Meeting-confirmation dispatch (SS2/11a) — fired by the delayed job
// enqueueMeetingConfirmDispatch enqueues (~24h before the booked slot).
// Mirrors handleCallRequest's own contract exactly: dispatchMeetingConfirmCall
// is fully fail-safe (every outcome except a transport-level balance-check
// failure COMPLETES the job), so a retry can never place a second call.
// getMeetingConfirmDispatchConfig() re-reads app_settings fresh on every
// firing — the kill switch and rule_id are never stale-cached across a job
// that may sit queued for up to 24h.
async function handleMeetingConfirmDispatch(job: MeetingConfirmJob): Promise<void> {
  const config = await getMeetingConfirmDispatchConfig();
  if (!config) {
    // Not configured (no rule_id / caller_id / service account yet) or the
    // channel is off — a normal, expected steady state pre-launch, not an
    // error. Complete the job; the row stays 'scheduled' and simply never
    // gets an automated reminder until the channel is turned on.
    return;
  }
  const appOrigin = await getAppOrigin();
  const result = await dispatchMeetingConfirmCall(job.data.callbackRequestId, config, appOrigin);
  if (result.kind === 'transient_error') {
    throw new Error(`voximplant balance check failed: ${result.reason}`);
  }
  console.log('[kalfa-worker] meeting-confirm dispatch resolved', {
    jobId: job.id,
    callbackRequestId: job.data.callbackRequestId,
    kind: result.kind,
    ...('reason' in result ? { reason: result.reason } : {}),
  });
}

// Sales-closing dispatch — fired by enqueueSalesCallDispatch, at
// scheduled_at itself (not 24h ahead, unlike the meeting-confirm job above).
// Same fail-safe contract as handleMeetingConfirmDispatch: only a transport-
// level balance-check failure is retryable.
async function handleSalesCallDispatch(job: SalesCallJob): Promise<void> {
  const config = await getSalesCallDispatchConfig();
  if (!config) {
    // Channel off / unconfigured — normal steady state pre-launch, not an
    // error. Complete the job; the reconciler has no visibility into
    // pg-boss, so no alert is needed for an intentionally-disabled channel.
    return;
  }
  const appOrigin = await getAppOrigin();
  const result = await dispatchSalesCall(job.data.callbackRequestId, config, appOrigin);
  if (result.kind === 'transient_error') {
    throw new Error(`voximplant balance check failed: ${result.reason}`);
  }
  console.log('[kalfa-worker] sales-call dispatch resolved', {
    jobId: job.id,
    callbackRequestId: job.data.callbackRequestId,
    kind: result.kind,
    ...('reason' in result ? { reason: result.reason } : {}),
  });
}

// Data-layer throws for a failed Supabase/Postgrest call attach the original
// error as `cause` (see e.g. claimUnprocessedWebhookEvents) so the generic
// Hebrew message shown to that layer's other callers doesn't erase the
// diagnostic code underneath. Surface that code here — it's a Postgres/
// PostgREST error code, never guest data — so an ops alert alone is enough to
// triage a recurrence without a live DB query.
function errorDetail(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown error';
  const cause = e.cause;
  if (cause && typeof cause === 'object' && 'message' in cause) {
    const rawCode =
      'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : '';
    // PostgrestError's own fields are always strings, but a fetch/network
    // failure surfaces the same {message,details,hint,code} shape with code
    // defaulted to '' — skip the brackets rather than print "[]".
    const code = rawCode.length > 0 ? rawCode : undefined;
    return `${e.message} — ${code ? `[${code}] ` : ''}${String((cause as { message: unknown }).message)}`;
  }
  return e.message;
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
        detail: errorDetail(e),
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

// Inquiry silence follow-up sweep — same periodic-tick idiom as
// handleThankyouSweep above. Its OWN kill-switch
// (app_settings.inquiry_followup_enabled), deliberately NOT outreach_enabled:
// this sweep emails inquiry senders, not campaign contacts, and an unrelated
// campaign incident must not silently stop support follow-ups (or vice
// versa).
async function handleInquiryFollowupSweep(): Promise<void> {
  if (!(await getInquiryFollowupEnabled())) return;
  await runInquiryFollowupSweep();
}


// ── Push instead of poll ────────────────────────────────────────────────────
// A dedicated LISTEN connection so a callback request is scheduled the moment
// it is ready, not on the next tick. The database announces (trigger
// callback_requests_notify_work → channel callback_work); this reacts.
//
// Verified on this project's connection before it was written: LISTEN needs a
// SESSION-mode connection, and transaction-mode pooling drops it in silence.
// Port 5432 on the Supabase pooler is session mode — hence the same env the
// pg-boss client above uses, deliberately, rather than a second definition
// that could drift out of session mode without anyone noticing.
//
// This is an OPTIMISATION, never the guarantee. NOTIFY is fire-and-forget: with
// no listener attached at that instant — a restart, a dropped connection, a
// deploy — the announcement is gone for good. The cron schedule below is what
// makes the work eventually happen regardless, which is why it stays.
// A Client, not a Pool: LISTEN is per-connection state, and a pool is free to
// hand back a different connection — or recycle the subscribed one — leaving a
// listener that is attached to nothing and reports no error.
//
// The driver arrives as a plain static import. It must NOT be loaded through
// createRequire(import.meta.url) the way the fleet CLI does: the CLI runs as
// real ESM, whereas this file is bundled to CJS, where esbuild leaves
// `import.meta.url` undefined and createRequire throws during module load —
// before a single line here runs, which takes the whole worker down in a
// restart loop that no amount of typechecking or `next build` would catch.

const NOTIFY_CHANNEL = 'callback_work';
// A burst of requests announces a burst of times. One sweep drains all of them,
// so anything arriving while a sweep is in flight — or moments after one — is
// folded into a single follow-up run rather than starting its own.
const NOTIFY_COALESCE_MS = 3_000;

function startCallbackWorkListener(boss: PgBoss): () => Promise<void> {
  let client: PgClient | null = null;
  let stopped = false;
  let sweeping = false;
  let pending = false;
  let reconnecting = false;
  let retryMs = 1_000;

  const drain = async (): Promise<void> => {
    if (sweeping) {
      pending = true;
      return;
    }
    sweeping = true;
    try {
      // Logged because a push-triggered sweep is otherwise invisible: the
      // notification line above proves the announcement arrived, not that the
      // work ran or what it decided.
      const r = await runCallbackSchedulingSweep({ boss });
      console.log(
        `[callback-listen] sweep — שובצו ${r.scheduled}, נדחו ${r.skipped}, שוחררו ${r.released}, תוקנו ${r.repaired}`,
      );
    } catch (e) {
      console.error('[callback-listen] sweep failed:', e instanceof Error ? e.message : e);
    } finally {
      sweeping = false;
      if (pending) {
        pending = false;
        setTimeout(() => void drain(), NOTIFY_COALESCE_MS);
      }
    }
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    // Cleared here rather than after connecting: a failure below calls
    // reconnect(), which must not find its own guard still raised.
    reconnecting = false;
    try {
      client = new PgClient({
        host: process.env.SUPABASE_DB_HOST,
        port: Number(process.env.SUPABASE_DB_PORT || 5432),
        user: process.env.SUPABASE_DB_USER,
        password: process.env.SUPABASE_DB_PASSWORD,
        database: process.env.SUPABASE_DB_NAME || 'postgres',
        ssl: { rejectUnauthorized: false },
        application_name: 'kalfa-worker-listen',
      });
      // A dropped LISTEN is the failure mode that kills this quietly: the
      // process stays up, the channel is simply no longer subscribed. Reconnect
      // and re-LISTEN, backing off so a database outage is not hammered.
      client.on('error', (e: Error) => {
        console.error('[callback-listen] connection error:', e.message);
        void reconnect();
      });
      client.on('end', () => void reconnect());
      client.on('notification', (msg: { channel: string; payload?: string }) => {
        if (msg.channel !== NOTIFY_CHANNEL) return;
        console.log(`[callback-listen] ${msg.payload ?? '(no payload)'}`);
        void drain();
      });
      await client.connect();
      await client.query(`listen ${NOTIFY_CHANNEL}`);
      retryMs = 1_000;
      console.log('[callback-listen] subscribed');
    } catch (e) {
      console.error('[callback-listen] connect failed:', e instanceof Error ? e.message : e);
      void reconnect();
    }
  };

  // One recovery at a time, however many events announce the same failure. A
  // dropped connection emits BOTH 'error' and 'end' — measured, not assumed —
  // and without this guard each one opened its own connection: the channel got
  // a second subscriber, every notification was handled twice, and the earlier
  // client was no longer referenced so nothing ever closed it. Every subsequent
  // drop then doubled the count again.
  const reconnect = async (): Promise<void> => {
    if (stopped || reconnecting) return;
    reconnecting = true;
    const c = client;
    client = null;
    if (c) {
      // Detach first: a client being torn down still emits, and those events
      // belong to a connection this closure has already given up on. 'error' is
      // replaced rather than merely removed — an EventEmitter that emits 'error'
      // with no listener throws, which would take the worker down.
      c.removeAllListeners('notification');
      c.removeAllListeners('end');
      c.removeAllListeners('error');
      c.on('error', () => {});
      await c.end().catch(() => {});
    }
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, 60_000);
    setTimeout(() => void connect(), wait);
  };

  void connect();

  return async () => {
    stopped = true;
    const c = client;
    client = null;
    if (c) await c.end().catch(() => {});
  };
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
    // Raised from the original 4 (measured, 03.08): 14 queues now share this
    // pool, several on the same "* * * * *" tick, and pg-pool's own connect()
    // rejects with "timeout exceeded when trying to connect" once a burst
    // exceeds `max` and waits past `connectionTimeoutMillis` — confirmed via
    // pgboss.job that every one of those bursts' jobs still completed a few
    // seconds later, i.e. genuine contention, not a dead DB. Doubling both
    // gives a same-minute burst realistic room without holding many more
    // connections open at rest (idle ones still close per idleTimeoutMillis).
    max: 8,
    connectionTimeoutMillis: 20_000,
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
    // callbackSweep is a singleton for the same reason as thankyouSweep, and it
    // matters more here: an overlapping tick would be two processes reading the
    // same "due and unclaimed" row. The atomic claim
    // (UPDATE ... WHERE callback_dispatched_at IS NULL) already makes a double
    // dial impossible, but a guest's phone ringing twice is not a race worth
    // leaving to one defence.
    const singleton =
      q === QUEUES.thankyouSweep ||
      q === QUEUES.logExport ||
      q === QUEUES.callbackSweep ||
      // Singleton too: two ticks reading the same "unscheduled" rows would each
      // create an appointment. The partial unique index on calendar_item_id and
      // the `.is(calendar_item_id, null)` guard on the write already make a
      // duplicate impossible, but a second item appearing in the owner's
      // calendar is not a race worth leaving to one defence.
      q === QUEUES.callbackScheduleSweep ||
      // Singleton too: this is a WEEKLY cron, so overlap is unlikely, but an
      // overlapping run would refresh the same not-yet-rotated token twice in
      // flight against Meta and race the two atomic .env.local rewrites
      // against each other. Nothing else defends against that (there is no
      // per-row lease here, unlike the other IO-writing crons above).
      q === QUEUES.igTokenRefresh ||
      // Singleton too: an overlapping tick would open two concurrent NTLM
      // sessions against the same agent's mailbox for no benefit — the sync
      // is a plain upsert keyed on agent_id, so a second run mid-flight can
      // only repeat work, never corrupt it, but there is no reason to allow
      // the overlap.
      q === QUEUES.calendarPresenceSync ||
      // Singleton too: two overlapping ticks would each see a subscription
      // that is missing or near expiry and each create one, leaving a
      // duplicate that delivers every message twice. ensureIntakeSubscription
      // prunes duplicates on the next pass, but not creating them is better.
      q === QUEUES.graphIntakeRenew ||
      // Singleton too, for the same reason as thankyouSweep: an overlapping cron
      // tick could re-select a row whose stamp the previous tick hasn't written
      // yet, and (unlike thankyouSweep) there is no atomic per-row claim here to
      // fall back on — see docs/inquiry-email-threading-fix-plan-2026-08-25.md
      // §2.6 for the send-level idempotency key that covers the *sequential*
      // retry-after-crash case this singleton policy alone does not.
      q === QUEUES.inquiryFollowupSweep;
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
    QUEUES.meetingConfirmDispatch,
    guardedWorker(QUEUES.meetingConfirmDispatch, async (jobs: MeetingConfirmJob[]) => {
      for (const job of jobs) await handleMeetingConfirmDispatch(job);
    }),
  );
  await boss.work(
    QUEUES.salesCallDispatch,
    guardedWorker(QUEUES.salesCallDispatch, async (jobs: SalesCallJob[]) => {
      for (const job of jobs) await handleSalesCallDispatch(job);
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
  await boss.work(
    QUEUES.inquiryFollowupSweep,
    guardedWorker(QUEUES.inquiryFollowupSweep, async () => {
      await handleInquiryFollowupSweep();
    }),
  );
  // Callback re-dials. runCallbackSweep only ENQUEUES — every dial gate is
  // re-read by dispatchOutreachCall when the callRequest job runs, so a
  // callback that became ineligible between the request and its due time (event
  // closed, consent revoked, number added to the DNC list) is refused at dial
  // time, not here.
  await boss.work(
    QUEUES.callbackSweep,
    guardedWorker(QUEUES.callbackSweep, async () => {
      await runCallbackSweep(boss);
    }),
  );
  // Books calendar time for leads from the public contact page. Writes to
  // Exchange, never to the phone system — the two callback sweeps share a name
  // and nothing else. Fail-closed on its own: no verified connection, an
  // ambiguous one, or a failed calendar read all end the tick without writing.
  await boss.work(
    QUEUES.callbackScheduleSweep,
    guardedWorker(QUEUES.callbackScheduleSweep, async () => {
      // Logged for the same reason the LISTEN path above logs its own result:
      // a sweep that reports nothing cannot be told apart from a sweep that did
      // nothing. MEASURED 16.08 — the tick that re-created fourteen stranded
      // customer callbacks and wrote fourteen appointments into Graph left no
      // line at all, and only a DB query could confirm it had happened.
      //
      // Not redundant with the Slack alerts inside the sweep: those are
      // fail-open and can be switched off per category, and a chat room is not
      // something you can grep six days later while diagnosing.
      const r = await runCallbackSchedulingSweep({ boss });
      // Quiet ticks are the normal case, so speak only when something moved —
      // otherwise this prints every ten minutes forever and becomes the noise
      // it exists to cut through.
      if (r.scheduled || r.released || r.repaired) {
        console.log(
          `[callback-cron] sweep — שובצו ${r.scheduled}, נדחו ${r.skipped}, שוחררו ${r.released}, תוקנו ${r.repaired}`,
        );
      }
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
  // Same H3 pattern, extended 2026-08-22 to the other two dispatch surfaces
  // that now share this Voximplant account's concurrency ceiling.
  await boss.work(
    QUEUES.callbackDispatchReconcile,
    guardedWorker(QUEUES.callbackDispatchReconcile, async () => {
      await runCallbackDispatchReconcile();
    }),
  );
  await boss.work(
    QUEUES.salesDispatchReconcile,
    guardedWorker(QUEUES.salesDispatchReconcile, async () => {
      await runSalesDispatchReconcile();
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
  // WhatsApp template health reconciliation — daily. Read-only against Meta,
  // config-gated (no-op without whatsapp_waba_id/access token), never throws.
  await boss.work(
    QUEUES.templateHealthSync,
    guardedWorker(QUEUES.templateHealthSync, async () => {
      await runTemplateHealthSync();
    }),
  );
  // call_dispatch_status retention: daily delete of rows older than 30 days
  // (status channel, not audit — activity_log keeps the durable record).
  // runDispatchRetention never throws.
  await boss.work(
    QUEUES.dispatchRetention,
    guardedWorker(QUEUES.dispatchRetention, async () => {
      await runDispatchRetention();
    }),
  );
  // Instagram long-lived access-token self-refresh — weekly. Keeps
  // META_IG_ACCESS_TOKEN (.env.local) from reaching its 60-day expiry with no
  // human OAuth step. runInstagramTokenRefresh never throws (every branch
  // alerts or no-ops and returns).
  await boss.work(
    QUEUES.igTokenRefresh,
    guardedWorker(QUEUES.igTokenRefresh, async () => {
      await runInstagramTokenRefresh();
    }),
  );
  // Microsoft Graph mail-intake subscription renewal. runGraphIntakeSubscription
  // Sweep never throws (it alerts and returns), and is a no-op when the Graph
  // app identity or the intake mailbox is not configured for this deployment.
  await boss.work(
    QUEUES.graphIntakeRenew,
    guardedWorker(QUEUES.graphIntakeRenew, async () => {
      await runGraphIntakeSubscriptionSweep();
    }),
  );
  // Console-agent calendar presence sync (Outlook/Exchange research, 12.8):
  // per-agent EWS free/busy read → console_agent_calendar_presence (advisory
  // only — never writes agent_status). runConsoleAgentCalendarPresenceSync
  // never throws (one agent's broken mailbox does not stop the rest) and
  // is a no-op when no console agent has a verified Exchange connection.
  await boss.work(
    QUEUES.calendarPresenceSync,
    guardedWorker(QUEUES.calendarPresenceSync, async () => {
      await runConsoleAgentCalendarPresenceSync();
    }),
  );
  // Fleet-request expiry sweep: pending fleet_requests past expires_at become
  // 'expired' so /admin/fleet stops showing them as open (the answer RPC
  // refuses expired requests by design — without this tick they are stuck
  // until chief-of-staff's daily CLI sweep, or forever when that run is
  // missed). Idempotent CAS update; a DB error throws into guardedWorker
  // (alert) and the next tick retries.
  await boss.work(
    QUEUES.fleetExpireSweep,
    guardedWorker(QUEUES.fleetExpireSweep, async () => {
      await runFleetExpireSweep(createAdminClient());
    }),
  );

  await boss.schedule(QUEUES.arm, '* * * * *');
  await boss.schedule(QUEUES.sweeper, '*/5 * * * *');
  await boss.schedule(QUEUES.webhook, '* * * * *');
  await boss.schedule(QUEUES.thankyouSweep, '*/5 * * * *');
  await boss.schedule(QUEUES.inquiryFollowupSweep, '*/5 * * * *');
  // Every 5 minutes: close enough that "מחר בערב" lands when the guest expects,
  // coarse enough that it is not polling. A callback is due at a time the guest
  // chose, so precision beyond a few minutes buys nothing.
  await boss.schedule(QUEUES.callbackSweep, '*/5 * * * *');
  // Every 10 minutes. A lead who just submitted the form is not waiting on the
  // appointment itself — the minimum-notice guard puts the call two hours out
  // regardless — so a tighter tick would only mean more Exchange round trips.
  // The BACKSTOP, not the main path: the LISTEN above schedules within a
  // second of a request becoming ready. This catches anything that announced
  // while nothing was listening — a restart, a dropped connection, a deploy.
  await boss.schedule(QUEUES.callbackScheduleSweep, '*/10 * * * *');
  const stopCallbackListener = startCallbackWorkListener(boss);
  await boss.schedule(QUEUES.balanceCheck, '*/30 * * * *');
  await boss.schedule(QUEUES.callReconcile, '*/10 * * * *');
  await boss.schedule(QUEUES.callbackDispatchReconcile, '*/10 * * * *');
  await boss.schedule(QUEUES.salesDispatchReconcile, '*/10 * * * *');
  // Anchored to a wall-clock hour → run on Israel local time (DST-aware).
  await boss.schedule(QUEUES.logExport, '20 3 * * *', null, { tz: SCHEDULE_TZ });
  await boss.schedule(QUEUES.elevenlabsQuota, '0 */6 * * *', null, { tz: SCHEDULE_TZ });
  await boss.schedule(QUEUES.templateHealthSync, '35 3 * * *', null, { tz: SCHEDULE_TZ });
  await boss.schedule(QUEUES.dispatchRetention, '40 3 * * *', null, { tz: SCHEDULE_TZ });
  // Weekly, off-peak, deliberately non-round (04:17) — a 60-day token refreshed
  // once a week has ample margin even if a run is missed for a while.
  await boss.schedule(QUEUES.igTokenRefresh, '17 4 * * 2', null, { tz: SCHEDULE_TZ });
  // Every 6 hours. The subscription lives ~2.94 days and renewal triggers under
  // 24h remaining, so four chances a day means a renewal survives a full day of
  // worker downtime without intake ever lapsing.
  await boss.schedule(QUEUES.graphIntakeRenew, '23 */6 * * *', null, { tz: SCHEDULE_TZ });
  // Every 10 minutes — a calendar event's start/end is minute-granular at best,
  // so a tighter tick would only mean more remote Graph round trips against the
  // same mailbox(es) for no material gain in freshness. (Pre-Graph this also
  // bought a saved NTLM/SOAP handshake per agent; Graph caches its token, so
  // freshness is now the whole argument.) Same cadence family as
  // callbackScheduleSweep (also calendar-backed, also */10).
  await boss.schedule(QUEUES.calendarPresenceSync, '*/10 * * * *');
  // Every 10 minutes — expiry windows are 72h, so minute-precision buys
  // nothing; 10m keeps a dead request from ever looking open for long.
  await boss.schedule(QUEUES.fleetExpireSweep, '*/10 * * * *');

  console.log('[kalfa-worker] started — queues + schedules up');

  const shutdown = async (): Promise<void> => {
    console.log('[kalfa-worker] SIGTERM — stopping gracefully');
    await stopCallbackListener();
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
