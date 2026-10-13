import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { PgBoss } from 'pg-boss';
import { Pool } from 'pg';

vi.mock('server-only', () => ({}));

import { enqueueStepJob } from './enqueue';
import { detId, deferId } from './schedule';
import { QUEUES, isFinalDelivery } from '@/lib/queue/queues';
import { resolveTestDb, testDbSsl } from './test-db-guard';

// ─────────────────────────────────────────────────────────────────────────────
// §8.2 / §11.10 — STRICT-isolation pg-boss integration. Each run creates a UNIQUE
// disposable schema, drives the real enqueue path against it, and DROPs it in a
// finally (asserting no `pgboss_test_%` leftover). It NEVER connects to / reads /
// writes the real `pgboss` schema.
//
// GATED: requires a TEST-ONLY trio (OUTREACH_TEST_DB_URL / OUTREACH_TEST_SUPABASE_URL
// / OUTREACH_TEST_SERVICE_ROLE_KEY) via test-db-guard. It HARD-FAILS if pointed at
// the production project (.env.local URL/host or the prod ref) — never the linked
// prod DB. Allowed: Supabase local or a dedicated test DB.
// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH_DB_IT=1 is the opt-in; when set, resolveTestDb() THROWS immediately if
// the OUTREACH_TEST_* trio is missing OR points at prod → fail-fast at module load
// (never a silent skip). Unset → tests skip.
const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

const dbCfg = () => ({
  connectionString: TEST!.dbUrl,
  ssl: testDbSsl(TEST!.dbUrl),
});

// A lowercase-hex + underscore identifier — the schema name is interpolated into SQL.
const uniqueSchema = () => `pgboss_test_${randomUUID().replace(/-/g, '')}`;

const ENQ = {
  campaignId: randomUUID(),
  contactId: randomUUID(),
  eventId: randomUUID(),
  stepIndex: 0,
  planRev: 'a'.repeat(64),
};

describe.skipIf(!RUN)('pg-boss isolation — deterministic ids + at-most-once', () => {
  let schema: string;
  let boss: PgBoss;
  let pool: Pool;

  const jobRows = (id: string) =>
    pool
      .query(`select id, name, state, retry_count, retry_limit from ${schema}.job where id=$1 and name=$2`, [
        id,
        QUEUES.step,
      ])
      .then((r) => r.rows);

  const liveStepJobs = () =>
    pool
      .query(
        `select id from ${schema}.job where name=$1 and state <> 'completed' and state <> 'cancelled'`,
        [QUEUES.step],
      )
      .then((r) => r.rows);

  beforeEach(async () => {
    schema = uniqueSchema();
    pool = new Pool({ ...dbCfg(), max: 2, application_name: 'kalfa-pgboss-it' });
    boss = new PgBoss({ ...dbCfg(), schema });
    boss.on('error', () => {});
    await boss.start(); // creates the isolated schema
    await boss.createQueue(QUEUES.step);
    await boss.createQueue(QUEUES.dead);
  });

  afterEach(async () => {
    try {
      await boss.stop({ graceful: false });
    } finally {
      // ABSOLUTE isolation: drop only OUR schema, then prove it is gone. Never
      // touches the real `pgboss` schema. Our own name, not every `pgboss_test_%`:
      // another integration file may hold its disposable schema at this moment
      // (vitest runs files in parallel).
      await pool.query(`drop schema if exists ${schema} cascade`);
      const leftover = await pool.query(`select nspname from pg_namespace where nspname = $1`, [schema]);
      expect(leftover.rows).toHaveLength(0);
      await pool.end();
    }
  });

  it('double-run of the same plan step → NO duplicate (the deterministic detId collapses to one row)', async () => {
    const args = { mode: 'plan' as const, ...ENQ, targetSlotMs: 1_800_000_000_000, runAtMs: 1_800_000_000_000 };
    await enqueueStepJob(boss, args);
    await enqueueStepJob(boss, args); // idempotent — second boss.send → null
    const id = detId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev);
    expect(await jobRows(id)).toHaveLength(1);
    expect(await liveStepJobs()).toHaveLength(1);
  });

  it('a plan-rev change mints a NEW id (a re-planned step is a distinct job)', async () => {
    await enqueueStepJob(boss, { mode: 'plan', ...ENQ, targetSlotMs: 1_800_000_000_000, runAtMs: 1_800_000_000_000 });
    const otherRev = 'b'.repeat(64);
    await enqueueStepJob(boss, { mode: 'plan', ...ENQ, planRev: otherRev, targetSlotMs: 1_800_000_000_000, runAtMs: 1_800_000_000_000 });
    expect(await jobRows(detId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev))).toHaveLength(1);
    expect(await jobRows(detId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, otherRev))).toHaveLength(1);
    expect(await liveStepJobs()).toHaveLength(2);
  });

  it('F.9(1): a detId that COMPLETED during pause blocks its own re-send; resume via deferId is the single live job (at-most-once)', async () => {
    const slot = 1_800_000_000_000;
    const detJobId = detId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev);
    // The original execution job (detId) is enqueued, then reaches 'completed'
    // while the campaign is paused.
    await enqueueStepJob(boss, { mode: 'plan', ...ENQ, targetSlotMs: slot, runAtMs: slot });
    await pool.query(`update ${schema}.job set state='completed', completed_on=now() where id=$1 and name=$2`, [
      detJobId,
      QUEUES.step,
    ]);

    // A re-send under the SAME detId is BLOCKED (the completed row wins ON
    // CONFLICT) → the old touchpoint can never fire again.
    const resend = await boss.send(
      QUEUES.step,
      { ...ENQ, mode: 'plan', targetSlotMs: slot },
      { id: detJobId },
    );
    expect(resend).toBeNull();

    // On resume, ensureCurrentStep enqueues via deferId — a FRESH identity that
    // routes around the terminal detId.
    await enqueueStepJob(boss, { mode: 'defer', ...ENQ, targetSlotMs: slot, runAtMs: slot });
    const deferJobId = deferId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev, slot);
    expect(deferJobId).not.toBe(detJobId);
    expect(await jobRows(deferJobId)).toHaveLength(1);
    // Exactly ONE live (non-terminal) step job — the deferId; the detId stays completed.
    const live = await liveStepJobs();
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(deferJobId);
  });

  it('includeMetadata hands the handler the retryCount/retryLimit the row stores, on every delivery (the SELECT the call-request path used to make)', async () => {
    const queue = 'call-meta-it';
    await boss.createQueue(queue);
    await boss.send(queue, { n: 1 }, { retryLimit: 2, retryDelay: 0 });

    type Counts = { retryCount: number; retryLimit: number };
    const seen: Array<{ meta: Counts; stored: Counts; final: boolean }> = [];
    await boss.work(queue, { includeMetadata: true, pollingIntervalSeconds: 0.5 }, async (jobs) => {
      for (const job of jobs) {
        // Read the row from inside the handler: this is exactly the moment the old
        // getJobRetryMeta() query ran.
        const { rows } = await pool.query(
          `select retry_count, retry_limit from ${schema}.job where name=$1 and id=$2`,
          [queue, job.id],
        );
        seen.push({
          meta: { retryCount: job.retryCount, retryLimit: job.retryLimit },
          stored: { retryCount: Number(rows[0].retry_count), retryLimit: Number(rows[0].retry_limit) },
          final: isFinalDelivery(job),
        });
      }
      throw new Error('fail on purpose: drive the next delivery');
    });

    await vi.waitFor(() => expect(seen).toHaveLength(3), { timeout: 20_000, interval: 250 });
    // Three deliveries, retryCount 0 → 1 → 2 against a limit of 2 …
    expect(seen.map((s) => s.meta)).toEqual([
      { retryCount: 0, retryLimit: 2 },
      { retryCount: 1, retryLimit: 2 },
      { retryCount: 2, retryLimit: 2 },
    ]);
    // … each identical to what the row held at that moment (the 1:1 claim) …
    for (const s of seen) expect(s.meta).toEqual(s.stored);
    // … and only the last one is "final" (handleCallRequest settles its dispatch row here).
    expect(seen.map((s) => s.final)).toEqual([false, false, true]);
  });
});
