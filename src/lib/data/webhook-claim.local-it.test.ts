import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  type Fixture,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

// Finding 3 — claim_webhook_events has a ROW LOCK, not a LEASE.
//
//   claim_webhook_events(_limit): SELECT … WHERE processed_at IS NULL AND attempts < 5
//                                 ORDER BY received_at LIMIT _limit FOR UPDATE SKIP LOCKED
//   It writes nothing (no claimed_at / owner / expiry). The lock lives exactly as long
//   as the caller's transaction; claimUnprocessedWebhookEvents() calls it over
//   PostgREST, whose transaction ends when the HTTP request returns — i.e. BEFORE
//   processWebhookEvent starts.
//
// Two levels:
//   SQL/RPC   — two separate PostgreSQL connections (pg Pool clients) show the lock
//               semantics directly.
//   TS        — the exported claim / mark functions worker/main.ts handleWebhook()
//               calls (claimUnprocessedWebhookEvents → markWebhookEventFailed).
// No overlapping-drain scenarios: one kalfa-worker runs the webhook queue one job at
// a time (pg-boss localConcurrency 1; an overrunning handler blocks the next fetch),
// so two drains never hold the same row at once.
// The claim RPC is read-only, so calling it never mutates rows outside the fixtures;
// every assertion filters on fixture row ids.

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;
const CLAIM_ALL = 1000;

type Row = Parameters<typeof import('@/lib/data/webhook-processing').processWebhookEvent>[0];

describe.skipIf(!RUN)('finding 3: webhook claim — row lock vs lease', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let wh: typeof import('@/lib/data/webhooks');

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'webhook-claim', 8);
    scope = new FixtureScope(pool);
    wh = await import('@/lib/data/webhooks');
  });
  afterAll(async () => {
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
    }
  });

  const reply = async (f: Fixture, id = 'rsvp_declined') =>
    (await scope.insertInbox(f, {
      messageId: `wamid.${f.tag}.${randomUUID().slice(0, 6)}`,
      payload: { type: 'button', from: f.phone.replace('+', ''), button: { payload: id, text: id } },
      contextId: f.outboundWamid,
    })) as Row;
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
  const sqlClaim = async (c: PoolClient) =>
    (await c.query(`select id from public.claim_webhook_events($1)`, [CLAIM_ALL])).rows as Array<{ id: string }>;
  const inboxRow = async (id: string) =>
    (await pool.query(`select attempts, processed_at, last_error from public.webhook_inbox where id = $1`, [id])).rows[0];

  // ── SQL/RPC, two connections ───────────────────────────────────────────────
  it('SQL: while connection A holds its claim transaction open, connection B skips the row', async () => {
    const f = await scope.create();
    const row = await reply(f);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('begin');
      expect(ids(await sqlClaim(a))).toContain(row.id);
      expect(ids(await sqlClaim(b))).not.toContain(row.id);
      await a.query('commit');
    } finally {
      a.release();
      b.release();
    }
  });

  it('SQL: the moment A\'s claim transaction ends, B claims the SAME unprocessed row (no lease survives)', async () => {
    const f = await scope.create();
    const row = await reply(f);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('begin');
      expect(ids(await sqlClaim(a))).toContain(row.id);
      await a.query('commit'); // A now "processes" the row outside any transaction
      expect(ids(await sqlClaim(b))).toContain(row.id);
      const r = await inboxRow(row.id);
      expect(r).toMatchObject({ attempts: 0, processed_at: null }); // the claim recorded nothing
    } finally {
      a.release();
      b.release();
    }
  });

  // ── TS: the exported building blocks of handleWebhook ───────────────────────
  it('3c (retry ceiling): five recorded failures retire the row — claim stops returning it; it stays unprocessed with last_error', async () => {
    const f = await scope.create();
    const row = await reply(f);
    for (let i = 0; i < 5; i++) {
      const claimed = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id);
      expect(claimed, `claim #${i + 1}`).toBeDefined();
      await wh.markWebhookEventFailed(row.id, claimed!.attempts + 1, `it failure ${i + 1}`);
    }
    expect(ids(await wh.claimUnprocessedWebhookEvents(CLAIM_ALL))).not.toContain(row.id);
    expect(await inboxRow(row.id)).toMatchObject({ attempts: 5, processed_at: null, last_error: 'it failure 5' });
  });

  it.fails('KNOWN BUG 3d: a row whose processing kills the worker (no catch runs) is eventually retired by the ceiling', async () => {
    const f = await scope.create();
    const row = await reply(f);
    for (let i = 0; i < 6; i++) {
      // claim, then "crash": neither markWebhookEventProcessed nor markWebhookEventFailed runs
      expect(ids(await wh.claimUnprocessedWebhookEvents(CLAIM_ALL))).toContain(row.id);
    }
    expect(ids(await wh.claimUnprocessedWebhookEvents(CLAIM_ALL))).not.toContain(row.id);
  });

  it('characterization 3d: a crash leaves attempts untouched — the poison row is re-claimed forever, the ceiling never applies', async () => {
    const f = await scope.create();
    const row = await reply(f);
    for (let i = 0; i < 6; i++) expect(ids(await wh.claimUnprocessedWebhookEvents(CLAIM_ALL))).toContain(row.id);
    expect(await inboxRow(row.id)).toMatchObject({ attempts: 0, processed_at: null });
  });

  // ── lock duration, measured ────────────────────────────────────────────────
  // Probe: a SEPARATE connection asks for the same row lock with NOWAIT. 55P03
  // (lock_not_available) = somebody holds it; success = nobody does. The probe's own
  // lock is released with ROLLBACK — that releases a lock, it is not used as cleanup.
  const tryLockNowait = async (c: PoolClient, id: string): Promise<'free' | 'locked'> => {
    await c.query('begin');
    try {
      await c.query(`select id from public.webhook_inbox where id = $1 for update nowait`, [id]);
      return 'free';
    } catch (e) {
      if ((e as { code?: string }).code === '55P03') return 'locked';
      throw e;
    } finally {
      await c.query('rollback');
    }
  };

  it('lock duration: held for exactly the claiming transaction — locked inside it, free the instant claimUnprocessedWebhookEvents returns', async () => {
    const f = await scope.create();
    const row = await reply(f);
    const a = await pool.connect();
    const probe = await pool.connect();
    try {
      // control — the probe does detect a held lock
      await a.query('begin');
      expect(ids(await sqlClaim(a))).toContain(row.id);
      expect(await tryLockNowait(probe, row.id)).toBe('locked');
      await a.query('commit');
      expect(await tryLockNowait(probe, row.id)).toBe('free');
      // the worker's real path: RPC over PostgREST (its own transaction per request)
      const t0 = performance.now();
      const claimed = await wh.claimUnprocessedWebhookEvents(CLAIM_ALL);
      const rpcMs = performance.now() - t0;
      expect(ids(claimed)).toContain(row.id);
      expect(await tryLockNowait(probe, row.id)).toBe('free'); // 0 ms of protection after the call
      expect(rpcMs).toBeLessThan(5_000);
      expect(await inboxRow(row.id)).toMatchObject({ attempts: 0, processed_at: null }); // and no marker either
    } finally {
      a.release();
      probe.release();
    }
  });
});
