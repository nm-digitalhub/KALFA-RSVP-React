// The real wait before the first retry of a package-activation job, measured on a REAL pg-boss 12 against the LOCAL
// database, on a disposable schema of its own (created by start(), dropped after the run), as
// payment-orphans.local-it.test.ts does. Nothing else is read or written.
//
// Why it is measured here and not computed: pg-boss multiplies retryDelay by a random jitter (dist/plans.js, the retry
// INSERT's start_after), and the installed SQL raises 2 to retry_count + 1 where its documentation says retryCount.
// The unit test only checks the setting (package-activation-job.test.ts); this one checks what pg-boss schedules.
//
// The smallest wait is pinned, not sampled: inside a transaction that is rolled back, a random() of our own, in a
// schema listed before pg_catalog on the search path, answers 0 (the lower end of the real random()) and then 1 (its
// open upper end). The delay is read against job_now() in the same transaction, the clock the fail statement used.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgBoss, type Db, type JobWithMetadata } from 'pg-boss';
import type { Pool } from 'pg';

import { type LocalIntegrationEnv, newPool, requireLocalIntegrationEnv, useLocalAdminEnv } from '@/lib/testing/local-integration';
import { testDbSsl } from '@/lib/outreach/test-db-guard';
import { PACKAGE_ACTIVATION_RETRY, QUEUES, type PackageActivationJob } from '@/lib/queue/queues';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;

describe.skipIf(!RUN)('package-activation first retry, with pg-boss (local)', () => {
  let pool: Pool;
  let boss: PgBoss;
  const schema = `pgboss_test_${randomUUID().replace(/-/g, '')}`;
  // Created and dropped inside each rolled-back transaction; checked gone after the run.
  const fakeRandom = `it_random_${randomUUID().replace(/-/g, '')}`;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'package-activation-retry');
    boss = new PgBoss({ connectionString: ENV!.dbUrl, ssl: testDbSsl(ENV!.dbUrl), schema, supervise: false, schedule: false });
    boss.on('error', () => {});
    await boss.start(); // creates the disposable schema
    await boss.createQueue(QUEUES.packageActivation);
  });

  afterAll(async () => {
    if (!RUN) return;
    try {
      await boss?.stop({ graceful: false });
    } finally {
      await pool.query(`drop schema if exists ${schema} cascade`);
      const left = await pool.query(`select 1 from pg_namespace where nspname = any($1)`, [[schema, fakeRandom]]);
      expect(left.rows).toHaveLength(0);
      await pool.end();
    }
  });

  // Fails the fetched delivery with random() answering `value`, and returns how long pg-boss put the retry off. Rolled
  // back, so the job stays active on the same attempt and can be failed again.
  async function retryDelayMs(job: JobWithMetadata<PackageActivationJob>, value: number): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`create schema ${fakeRandom}`);
      await client.query(
        `create function ${fakeRandom}.random() returns double precision language sql as $$ select ${value}::double precision $$`,
      );
      await client.query(`set local search_path = ${fakeRandom}, pg_catalog, public`);
      const db: Db = { executeSql: (text, values) => client.query(text, values) };
      await boss.fail(QUEUES.packageActivation, job, { message: 'refused' }, { db });
      const { rows } = await client.query(
        `select state::text as state, extract(epoch from (start_after - ${schema}.job_now())) * 1000 as ms
           from ${schema}.job where id = $1`,
        [job.id],
      );
      expect(rows[0]?.state).toBe('retry');
      return Number(rows[0].ms);
    } finally {
      await client.query('rollback');
      client.release();
    }
  }

  it('waits longer than the activation-row repair window before the first retry, even at the smallest jitter', async () => {
    const { REPAIR_AFTER_MS } = await import('@/lib/payments/activate-paid-package');
    const id = randomUUID();
    await boss.send(QUEUES.packageActivation, { campaignId: randomUUID(), operationId: randomUUID() }, { id, ...PACKAGE_ACTIVATION_RETRY });
    const fetched = await boss.fetch<PackageActivationJob>(QUEUES.packageActivation, { batchSize: 50, includeMetadata: true });
    const job = fetched.find((j) => j.id === id);
    expect(job?.retryCount).toBe(0); // the first delivery

    const smallest = await retryDelayMs(job!, 0);
    const largest = await retryDelayMs(job!, 1);
    // Our random() is the one pg-boss read: moving it moved the delay.
    expect(largest).toBeGreaterThan(smallest);
    expect(smallest).toBeGreaterThan(REPAIR_AFTER_MS);
  });
});
