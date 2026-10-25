// The payment orphan sweep's second pass (design D23, task 21.5) against the LOCAL stack and a REAL pg-boss.
// Real: sweepWaitingActivations, the ledger read (loadOperationsOf / deriveStatus), campaigns, payment_operations and
// activity_log in local Supabase, and pg-boss 12 itself (getJobById, send, retry, fetch, fail) on a disposable schema
// of its own, created by pg-boss start() and dropped after the run, as web-sender.integration.test.ts does. The shared
// `pgboss` schema is never read or written; local Supabase has none.
// Replaced: Slack only (an outbound side effect).
//
// Only the second pass runs: the local database holds development rows (approved campaigns, pending operations) that
// the first pass would move to review. Assertions name the fixture's campaigns only; jobs the pass may queue for other
// paid local campaigns land in the disposable schema and are dropped with it.
//
// Fixture difference from a real purchase, as in activate-paid-package.local-it.test.ts: an unlocked pricing round and a
// payment row without lines (a locked round and ledger lines can never be deleted from the shared database).
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgBoss } from 'pg-boss';
import type { Pool } from 'pg';

import {
  type Fixture,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';
import { testDbSsl } from '@/lib/outreach/test-db-guard';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;
const PRICE = 1;
const ELEVEN_MINUTES = 11 * 60_000;

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn(async () => undefined) }));

describe.skipIf(!RUN)('payment orphan sweep, second pass, with pg-boss (local)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let boss: PgBoss;
  const schema = `pgboss_test_${randomUUID().replace(/-/g, '')}`;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'payment-orphans-activation');
    scope = new FixtureScope(pool);
    boss = new PgBoss({ connectionString: ENV!.dbUrl, ssl: testDbSsl(ENV!.dbUrl), schema, supervise: false, schedule: false });
    boss.on('error', () => {});
    await boss.start(); // creates the disposable schema
    const { QUEUES } = await import('@/lib/queue/queues');
    await boss.createQueue(QUEUES.packageActivation);
  });

  afterAll(async () => {
    if (!RUN) return;
    try {
      await boss?.stop({ graceful: false });
      await scope.cleanup();
    } finally {
      await pool.query(`drop schema if exists ${schema} cascade`);
      const left = await pool.query(`select 1 from pg_namespace where nspname = $1`, [schema]);
      expect(left.rows).toHaveLength(0);
      await pool.end();
    }
  });

  async function paidWaitingCampaign(): Promise<{ f: Fixture; operationId: string }> {
    const f = await scope.create({ campaignStatus: 'approved', noOutbound: true });
    await pool.query(
      `insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price) values ($1, $2, 0, $2)`,
      [f.campaignId, PRICE],
    );
    const { beginOperation, completeOperation } = await import('@/lib/payments/ledger');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const begun = await beginOperation(admin, {
      campaignId: f.campaignId,
      eventId: f.eventId,
      kind: 'package_purchase',
      amount: PRICE,
      provider: 'cardcom',
      providerTerminal: 99_999,
      providerOperation: 'ChargeOnly',
      meta: { payerUserId: f.ownerId, provider: 'cardcom' },
    });
    if (!('id' in begun)) throw new Error('fixture: the payment row was not opened');
    await completeOperation(admin, begun.id, { from: 'pending', outcome: 'succeeded' });
    return { f, operationId: begun.id };
  }

  const sweep = async (now: Date) => {
    const { sweepWaitingActivations } = await import('@/lib/data/payment-orphans');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    return sweepWaitingActivations(createAdminClient(), boss, now);
  };

  const jobRows = async (jobId: string) =>
    (await pool.query(`select state::text state, data, retry_limit from ${schema}.job where id = $1`, [jobId])).rows as Array<{
      state: string;
      data: { campaignId: string; operationId: string };
      retry_limit: number;
    }>;

  const retryRows = async (campaignId: string) =>
    (
      await pool.query(
        `select count(*)::int n from public.activity_log where action = 'campaign.activation_retried' and meta->>'campaignId' = $1`,
        [campaignId],
      )
    ).rows[0].n as number;

  it('queues a missing job once, under the payment\'s id; a second sweep adds nothing', async () => {
    const { f, operationId } = await paidWaitingCampaign();
    const { packageActivationJobId } = await import('@/lib/queue/queues');
    const jobId = packageActivationJobId(operationId);
    const later = new Date(Date.now() + ELEVEN_MINUTES);

    expect(await jobRows(jobId)).toHaveLength(0);
    await sweep(later);
    const rows = await jobRows(jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'created', data: { campaignId: f.campaignId, operationId }, retry_limit: 4 });

    await sweep(later);
    expect(await jobRows(jobId)).toHaveLength(1);
    expect(await retryRows(f.campaignId)).toBe(0);
  });

  it('leaves out a paid campaign whose event day has passed: no job, however many sweeps', async () => {
    // The database refuses a past event date (events_before_insert), so the sweep's clock is moved past the fixture's
    // event (30 days out) instead, as the activation test does.
    const { f, operationId } = await paidWaitingCampaign();
    const { packageActivationJobId } = await import('@/lib/queue/queues');
    const afterTheEvent = new Date(Date.now() + 40 * 86_400_000);
    await sweep(afterTheEvent);
    await sweep(new Date(afterTheEvent.getTime() + 86_400_000));
    expect(await jobRows(packageActivationJobId(operationId))).toHaveLength(0);
    expect(await retryRows(f.campaignId)).toBe(0);
  });

  it('leaves a fresh payment to its own job: nothing queued inside the grace period', async () => {
    const { operationId } = await paidWaitingCampaign();
    const { packageActivationJobId } = await import('@/lib/queue/queues');
    await sweep(new Date());
    expect(await jobRows(packageActivationJobId(operationId))).toHaveLength(0);
  });

  it('retries a failed job once a day, with one audit row and one alert', async () => {
    const { f, operationId } = await paidWaitingCampaign();
    const { QUEUES, packageActivationJobId } = await import('@/lib/queue/queues');
    const { sendSlackAlert } = await import('@/lib/alerts/slack');
    const jobId = packageActivationJobId(operationId);

    // A job that ran out of retries: sent with none left, fetched and failed through pg-boss itself.
    await boss.send(QUEUES.packageActivation, { campaignId: f.campaignId, operationId }, { id: jobId, retryLimit: 0 });
    const [fetched] = await boss.fetch(QUEUES.packageActivation, { batchSize: 50 }).then((js) => js.filter((j) => j.id === jobId));
    expect(fetched?.id).toBe(jobId);
    await boss.fail(QUEUES.packageActivation, jobId, new Error('every attempt refused'));
    expect((await jobRows(jobId))[0].state).toBe('failed');

    vi.mocked(sendSlackAlert).mockClear();
    const later = new Date(Date.now() + ELEVEN_MINUTES);
    await sweep(later);
    expect((await jobRows(jobId))[0]).toMatchObject({ state: 'retry', retry_limit: 1 });
    expect(await retryRows(f.campaignId)).toBe(1);
    const mine = vi.mocked(sendSlackAlert).mock.calls.filter(([a]) => a.fields?.campaign_id === f.campaignId);
    expect(mine).toHaveLength(1);
    expect(mine[0][0].fields).toMatchObject({ event_id: f.eventId, operation_id: operationId });

    // It fails again within the day: the sweep leaves it alone.
    const [again] = await boss.fetch(QUEUES.packageActivation, { batchSize: 50 }).then((js) => js.filter((j) => j.id === jobId));
    expect(again?.id).toBe(jobId);
    await boss.fail(QUEUES.packageActivation, jobId, new Error('still refused'));
    expect((await jobRows(jobId))[0].state).toBe('failed');
    await sweep(new Date(later.getTime() + 10 * 60_000));
    expect((await jobRows(jobId))[0].state).toBe('failed');
    expect(await retryRows(f.campaignId)).toBe(1);
  });
});
