// Entry of dist/owner-agent.cjs (npm run owner-agent:build): pm2
// `kalfa-owner-agent`, the process that answers the owner's WhatsApp questions
// (plans/owner-whatsapp-agent-plan.md §6, §8 stages 6b and 8). It is NOT the
// worker and does not use the fleet's global flock: a question never waits
// behind a batch job or a 20-minute fleet role.
//
//   QUEUES.ownerAgentReply        one job at a time → reply.ts (the answer)
//   QUEUES.ownerAgentIntakeSweep  every 5 minutes   → sweep.ts (stranded / expired rows)
//   QUEUES.ownerAgentRetention    daily, 04:15 IL   → retention.ts (7-day text, 14-day sessions)
//
// Started as `node --env-file=.env.local dist/owner-agent.cjs` from the
// repository root (ecosystem.config.cjs): Node loads the env file before any
// module runs, and the runner resolves every path from process.cwd().

import { PgBoss, type Job } from 'pg-boss';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { ownerAgentPaths, runOwnerAgent } from '@/lib/owner-agent/runner';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES, type OwnerAgentReplyJob } from '@/lib/queue/queues';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppText } from '@/lib/whatsapp/client';

import { OWNER_AGENT_REPLY_QUEUE_POLICY, OWNER_AGENT_STOP_TIMEOUT_MS } from './budgets';
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
    // The role has 15 session-mode slots and the worker holds up to 8. Three
    // queues, one job at a time: three connections are plenty.
    max: 3,
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

  const ours = [QUEUES.ownerAgentReply, QUEUES.ownerAgentIntakeSweep, QUEUES.ownerAgentRetention];
  const existing = new Set((await boss.getQueues([...ours])).map((q) => q.name));
  for (const name of ours) {
    if (!existing.has(name)) await boss.createQueue(name);
  }
  // Every start, so a change here reaches the queue. It applies to jobs
  // inserted from now on; pg-boss copies the policy onto a job at insert.
  await boss.updateQueue(QUEUES.ownerAgentReply, OWNER_AGENT_REPLY_QUEUE_POLICY);

  const store = createReplyStore(createAdminClient());
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
    alert: sendSlackAlert,
    log,
    now: Date.now,
  };

  await boss.work(
    QUEUES.ownerAgentReply,
    { batchSize: 1, localConcurrency: 1 },
    guarded(QUEUES.ownerAgentReply, async (jobs: Job<OwnerAgentReplyJob>[]) => {
      for (const job of jobs) await handleOwnerAgentReply(job, replyDeps);
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
    }),
  );

  await boss.work(
    QUEUES.ownerAgentRetention,
    { pollingIntervalSeconds: 30 },
    guarded(QUEUES.ownerAgentRetention, async () => {
      await runOwnerAgentRetention({ store, sessions, paths: ownerAgentPaths(repoDir), now: Date.now, log });
    }),
  );

  await boss.schedule(QUEUES.ownerAgentIntakeSweep, '*/5 * * * *');
  // Daily at 04:15 Israel time: off-peak, on a minute none of the worker's
  // nightly crons (03:20–04:50) uses.
  await boss.schedule(QUEUES.ownerAgentRetention, '15 4 * * *', null, { tz: SCHEDULE_TZ });

  log('[owner-agent] started — reply queue, sweep and retention up');
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
