// Entry of dist/owner-agent.cjs (npm run owner-agent:build): pm2
// `kalfa-owner-agent`, the process that answers the owner's WhatsApp questions
// (plans/owner-whatsapp-agent-plan.md §6, §8 stages 6b and 8). It is NOT the
// worker and does not use the fleet's global flock: a question never waits
// behind a batch job or a 20-minute fleet role.
//
//   QUEUES.ownerAgentReply        one job at a time → reply.ts (the answer), or a model-backed
//                                 report (reports/report.ts, lane 'model'): one model run at a time
//   QUEUES.ownerAgentIntakeSweep  every 5 minutes   → sweep.ts (stranded / expired rows)
//   QUEUES.ownerAgentRetention    daily, 04:15 IL   → retention.ts (7-day text, 14-day sessions)
//   QUEUES.ownerAgentReport       one job at a time → reports/report.ts (a proactive report);
//                                 planned by reports/tick.ts on the intake-sweep schedule
//
// Started as `node --env-file=.env.local dist/owner-agent.cjs` from the
// repository root (ecosystem.owner-agent.config.cjs): Node loads the env file before any
// module runs, and the runner resolves every path from process.cwd().

import { PgBoss, type Job } from 'pg-boss';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { REPORT_QUEUE_POLICY } from '@/lib/owner-agent/reports/budgets';
import { buildReportContent } from '@/lib/owner-agent/reports/content';
import { buildModelReportContent } from '@/lib/owner-agent/reports/model-content';
import { handleOwnerAgentReport, isOwnerAgentReportJob, type ReportDeps } from '@/lib/owner-agent/reports/report';
import { createReportStore } from '@/lib/owner-agent/reports/store';
import { runReportTick } from '@/lib/owner-agent/reports/tick';
import { ownerAgentPaths, runOwnerAgent } from '@/lib/owner-agent/runner';
import { createOwnerAgentWhatsApp } from '@/lib/owner-agent/whatsapp/adapter';
import { downloadOwnerAgentMedia } from '@/lib/owner-agent/whatsapp/media';
import { markReadWithTyping, sendOwnerAgentButtons, sendOwnerAgentList } from '@/lib/owner-agent/whatsapp/send';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES, type OwnerAgentReplyJob, type OwnerAgentReportJob } from '@/lib/queue/queues';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppTemplate, sendWhatsAppText } from '@/lib/whatsapp/client';

import {
  OWNER_AGENT_DB_POOL_MAX,
  OWNER_AGENT_REPLY_QUEUE_POLICY,
  OWNER_AGENT_STOP_TIMEOUT_MS,
  OWNER_AGENT_TYPING_REFRESH_ENV,
  typingRefreshMs,
} from './budgets';
import { handleOwnerAgentReply, type ReplyDeps } from './reply';
import { runOwnerAgentRetention } from './retention';
import { createSessionMemory, sessionsFilePath } from './sessions';
import { createReplyStore } from './store';
import { runStrandedIntakeSweep } from './sweep';

const SCHEDULE_TZ = 'Asia/Jerusalem';

// Code-shaped messages only. Anything else — a library error that might quote
// a row or a URL — is reported as `unexpected`.
const CODE_MESSAGE = /^[a-z][a-z0-9_]{0,80}$/;
function errorCode(e: unknown): string {
  return e instanceof Error && CODE_MESSAGE.test(e.message) ? e.message : 'unexpected';
}

function log(line: string): void {
  console.log(line);
}

// A handler that throws is reported (ids/codes only) and re-thrown, so
// pg-boss still sees the failure and retries — the worker's guardedWorker.
function guarded<T>(queue: string, handler: (jobs: T) => Promise<void>): (jobs: T) => Promise<void> {
  return async (jobs: T) => {
    try {
      await handler(jobs);
    } catch (e) {
      const code = errorCode(e);
      console.error(`[owner-agent] ${queue} failed: ${code}`);
      await sendSlackAlert({
        level: 'error',
        title: `owner-agent job failed: ${queue}`,
        detail: code,
        source: queue,
        category: 'errors',
      });
      throw e;
    }
  };
}

async function main(): Promise<void> {
  const repoDir = process.cwd();
  const boss = new PgBoss({
    // The worker's connection: the Supabase session pooler (port 5432) from
    // .env.local. See worker/main.ts for why every field is what it is.
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    schema: 'pgboss',
    application_name: 'kalfa-owner-agent',
    // Two, not more: see OWNER_AGENT_DB_POOL_MAX (the role's session-mode
    // slots are shared with the worker). Enough here — one job at a time, the
    // answer's own reads go through Supabase REST rather than this pool, and
    // pg-pool queues a third caller instead of failing it.
    max: OWNER_AGENT_DB_POOL_MAX,
    connectionTimeoutMillis: 20_000,
    // The worker owns the pgboss schema (migrations) and its maintenance
    // (expiry, retention, stats). This process only works its own queues and
    // keeps its own cron schedule firing (`schedule` stays on).
    migrate: false,
    supervise: false,
  });
  boss.on('error', (e: Error) => {
    console.error('[owner-agent] pgboss error:', errorCode(e));
  });

  // Registered BEFORE start (the worker's measured lesson, worker/main.ts): a
  // signal during the startup handshake must still stop gracefully. The stop
  // waits for an answer in flight — see budgets.ts for why that fits inside
  // pm2's kill_timeout.
  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log(`[owner-agent] ${signal} — stopping gracefully`);
    await boss.stop({ graceful: true, timeout: OWNER_AGENT_STOP_TIMEOUT_MS });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await boss.start();

  const ours = [
    QUEUES.ownerAgentReply,
    QUEUES.ownerAgentIntakeSweep,
    QUEUES.ownerAgentRetention,
    QUEUES.ownerAgentReport,
  ];
  const existing = new Set((await boss.getQueues([...ours])).map((q) => q.name));
  for (const name of ours) {
    if (!existing.has(name)) await boss.createQueue(name);
  }
  // Every start, so a change here reaches the queue. It applies to jobs
  // inserted from now on; pg-boss copies the policy onto a job at insert.
  await boss.updateQueue(QUEUES.ownerAgentReply, OWNER_AGENT_REPLY_QUEUE_POLICY);
  await boss.updateQueue(QUEUES.ownerAgentReport, REPORT_QUEUE_POLICY);

  const adminClient = createAdminClient();
  const store = createReplyStore(adminClient);
  const reportStore = createReportStore(adminClient);
  const sessions = createSessionMemory(sessionsFilePath(repoDir));
  const replyDeps: ReplyDeps = {
    store,
    sessions,
    run: (input) => runOwnerAgent(input, { repoDir }),
    // One token for the whole WABA; the reply goes out from the number the
    // question arrived on (reply.ts sets phoneNumberId from the intake row).
    sender: async (phoneNumberId) => {
      const config = await getWhatsAppConfig();
      return config ? { phoneNumberId, accessToken: config.accessToken, appSecret: config.appSecret } : null;
    },
    sendText: sendWhatsAppText,
    // The wa-layer (whatsapp/adapter.ts): one quiet-logger adapter per call,
    // built from the same sender. A throwing createOwnerAgentWhatsApp is
    // caught on every path in reply.ts.
    markRead: (s, wamid, timeoutMs) => markReadWithTyping(createOwnerAgentWhatsApp(s), wamid, timeoutMs),
    downloadMedia: (s, r) => downloadOwnerAgentMedia(createOwnerAgentWhatsApp(s), r),
    sendButtons: (s, p) => sendOwnerAgentButtons(createOwnerAgentWhatsApp(s), p),
    sendList: (s, p) => sendOwnerAgentList(createOwnerAgentWhatsApp(s), p),
    typingRefreshMs: typingRefreshMs(process.env[OWNER_AGENT_TYPING_REFRESH_ENV]),
    alert: sendSlackAlert,
    log,
    now: Date.now,
  };
  const reportDeps: ReportDeps = {
    store: reportStore,
    lane: 'report',
    // A report with instructions runs the model; it goes to the reply queue so
    // it never runs beside an answer (reports/report.ts header).
    reroute: async (runId) =>
      (await boss.send(QUEUES.ownerAgentReply, { runId } satisfies OwnerAgentReportJob, {
        id: deterministicJobId(`owner-report-model:${runId}`),
      })) !== null,
    content: (sections, period, nowMs) => buildReportContent(adminClient, sections, period, nowMs),
    // Same credentials as an answer; report.ts sets phoneNumberId to
    // owner_agent_phone_number_id, the number the report goes out from.
    sender: replyDeps.sender,
    sendText: sendWhatsAppText,
    sendTemplate: sendWhatsAppTemplate,
    alert: sendSlackAlert,
    log,
    now: Date.now,
  };
  const modelReportDeps: ReportDeps = {
    ...reportDeps,
    lane: 'model',
    reroute: undefined,
    // The answer's runner, never resumed and never remembered (model-content.ts).
    modelContent: (instructions, permissions, period, nowMs) =>
      buildModelReportContent((input) => runOwnerAgent(input, { repoDir }), instructions, permissions, period, nowMs),
  };

  // ONE worker, one job at a time: answers AND model-backed reports share it, so
  // at most one model run is in flight in this process.
  await boss.work(
    QUEUES.ownerAgentReply,
    { batchSize: 1, localConcurrency: 1 },
    guarded(QUEUES.ownerAgentReply, async (jobs: Job<OwnerAgentReplyJob | OwnerAgentReportJob>[]) => {
      for (const job of jobs) {
        if (isOwnerAgentReportJob(job.data)) await handleOwnerAgentReport(job, modelReportDeps);
        else await handleOwnerAgentReply(job, replyDeps);
      }
    }),
  );

  await boss.work(
    QUEUES.ownerAgentIntakeSweep,
    { pollingIntervalSeconds: 30 },
    guarded(QUEUES.ownerAgentIntakeSweep, async () => {
      await runStrandedIntakeSweep({
        store,
        enqueue: async (job, wamid) =>
          (await boss.send(QUEUES.ownerAgentReply, job, { id: deterministicJobId(wamid) })) !== null,
        log,
        now: Date.now,
      });
      // The report planner rides this schedule (plan §4.8). Its own try: a
      // planner fault is reported on its own and does not fail — and so retry —
      // the intake sweep above. Both are idempotent either way.
      try {
        await runReportTick({
          store: reportStore,
          enqueue: async (runId) =>
            (await boss.send(QUEUES.ownerAgentReport, { runId } satisfies OwnerAgentReportJob, {
              id: deterministicJobId(`owner-report:${runId}`),
            })) !== null,
          log,
          now: Date.now,
        });
      } catch (e) {
        const code = errorCode(e);
        console.error(`[owner-agent] report tick failed: ${code}`);
        await sendSlackAlert({
          level: 'error',
          title: 'owner-agent report tick failed',
          detail: code,
          source: 'owner-agent-report-tick',
          category: 'errors',
        });
      }
    }),
  );

  await boss.work(
    QUEUES.ownerAgentReport,
    { batchSize: 1, localConcurrency: 1 },
    guarded(QUEUES.ownerAgentReport, async (jobs: Job<OwnerAgentReportJob>[]) => {
      for (const job of jobs) await handleOwnerAgentReport(job, reportDeps);
    }),
  );

  await boss.work(
    QUEUES.ownerAgentRetention,
    { pollingIntervalSeconds: 30 },
    guarded(QUEUES.ownerAgentRetention, async () => {
      await runOwnerAgentRetention({
        store,
        sessions,
        paths: ownerAgentPaths(repoDir),
        now: Date.now,
        log,
        alert: sendSlackAlert,
      });
    }),
  );

  await boss.schedule(QUEUES.ownerAgentIntakeSweep, '*/5 * * * *');
  // Daily at 04:15 Israel time: off-peak, on a minute none of the worker's
  // nightly crons (03:20–04:50) uses.
  await boss.schedule(QUEUES.ownerAgentRetention, '15 4 * * *', null, { tz: SCHEDULE_TZ });

  log('[owner-agent] started — reply queue, sweep, retention and reports up');
}

main().catch(async (e) => {
  console.error('[owner-agent] fatal:', errorCode(e));
  await sendSlackAlert({
    level: 'error',
    title: 'owner-agent fatal',
    detail: errorCode(e),
    source: 'owner-agent-fatal',
    category: 'errors',
  });
  process.exit(1);
});
