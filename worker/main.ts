// KALFA outreach worker — the long-lived pg-boss process (pm2 `kalfa-worker`).
// Drives the §10 schedule across contacts: WhatsApp → wait → reminders →
// escalate-to-call → STOP on a billed reach. The web tier stays pg-boss-free;
// this process owns all send/work/schedule. Inert until outreach_enabled is on
// (stepGate fail-closes), so it is safe to run before go-live.
//
// Built with esbuild → dist/worker.cjs (server-only / next/headers / next/cache
// aliased to an empty stub; node_modules kept external). Run: node dist/worker.cjs.

import fs from 'node:fs';
import path from 'node:path';
import { PgBoss } from 'pg-boss';

import { QUEUES, STEP_RETRY } from '@/lib/queue/queues';
import {
  listActiveCampaigns,
  listActiveOutreach,
  getCampaignContext,
  seedOutreachState,
  stepGate,
  executeStep,
  setOutreachStatus,
} from '@/lib/data/outreach-engine';
import {
  nextTouchpointIndex,
  touchpointTime,
  detId,
} from '@/lib/outreach/schedule';
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

type StepData = {
  campaignId: string;
  contactId: string;
  eventId: string;
  stepIndex: number;
};

async function handleStep(boss: PgBoss, data: StepData): Promise<void> {
  const { campaignId, contactId, eventId, stepIndex } = data;
  const gate = await stepGate(campaignId, contactId, eventId);

  if (gate.reason === 'paused') {
    // Transient global gate — re-check in 5m (a fresh job, not the det id).
    await boss.send(QUEUES.step, data, { startAfter: 300 });
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

  // Schedule-next-FIRST so a send failure never breaks the chain.
  const nextIdx = nextTouchpointIndex(
    ctx.schedule,
    ctx.eventDate,
    stepIndex,
    Date.now(),
  );
  if (nextIdx !== null) {
    const tp = ctx.schedule[nextIdx];
    await boss.send(
      QUEUES.step,
      { campaignId, contactId, eventId, stepIndex: nextIdx },
      {
        id: detId(campaignId, contactId, nextIdx),
        startAfter: touchpointTime(ctx.eventDate, tp.days_before),
        ...STEP_RETRY,
      },
    );
  }

  const exec = await executeStep(ctx, campaignId, contactId, eventId, stepIndex);
  if (exec.action === 'call_request') {
    await boss.send(QUEUES.callRequest, exec.callRequest, {
      id: detId(campaignId, contactId, 100000 + stepIndex),
    });
  }
  if (nextIdx === null) {
    await setOutreachStatus(campaignId, contactId, 'exhausted');
  }
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

// Arm/sweep: enqueue each active contact's CURRENT step (idempotent via det id —
// already-scheduled steps no-op on conflict). Kickstarts step 0 and self-heals.
async function handleArm(boss: PgBoss): Promise<void> {
  for (const camp of await listActiveCampaigns()) {
    const ctx = await getCampaignContext(camp.id);
    if (!ctx || ctx.schedule.length === 0) continue;
    // Seed the cursor from the frozen authorized set (idempotent) — the single,
    // self-healing seeding path. Activation only flips status; the arm seeds.
    await seedOutreachState(camp.event_id, camp.id);
    for (const row of await listActiveOutreach(camp.id)) {
      const tp = ctx.schedule[row.current_step_index];
      if (!tp) continue;
      await boss.send(
        QUEUES.step,
        {
          campaignId: camp.id,
          contactId: row.contact_id,
          eventId: camp.event_id,
          stepIndex: row.current_step_index,
        },
        {
          id: detId(camp.id, row.contact_id, row.current_step_index),
          startAfter: touchpointTime(ctx.eventDate, tp.days_before),
          ...STEP_RETRY,
        },
      );
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
  });
  boss.on('error', (e: Error) => console.error('[pgboss]', e.message));
  await boss.start();

  for (const q of Object.values(QUEUES)) {
    await boss.createQueue(q);
  }

  await boss.work(QUEUES.step, async (jobs: { data: StepData }[]) => {
    for (const job of jobs) await handleStep(boss, job.data);
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
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('[kalfa-worker] fatal', e);
  process.exit(1);
});
