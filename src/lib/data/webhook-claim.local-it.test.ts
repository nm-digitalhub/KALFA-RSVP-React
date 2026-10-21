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
//   TS        — the exported functions worker/main.ts handleWebhook() chains, in the
//               same order (claimUnprocessedWebhookEvents → processWebhookEvent →
//               markWebhookEventProcessed | markWebhookEventFailed(id, attempts+1)).
//               handleWebhook itself is not exported and worker/main.ts starts pg-boss
//               on import, so this is NOT a Worker test: pg-boss scheduling, job
//               expiry (300 s) and the cron/nudge overlap are not exercised.
// The claim RPC is read-only, so calling it never mutates rows outside the fixtures;
// every assertion filters on fixture row ids.

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;
const CLAIM_ALL = 1000;

type Row = Parameters<typeof import('@/lib/data/webhook-processing').processWebhookEvent>[0];

describe.skipIf(!RUN)('finding 3: webhook claim — row lock vs lease', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let wp: typeof import('@/lib/data/webhook-processing');
  let wh: typeof import('@/lib/data/webhooks');

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'webhook-claim', 8);
    scope = new FixtureScope(pool);
    wp = await import('@/lib/data/webhook-processing');
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
  const billed = async (f: Fixture) =>
    (await pool.query(`select count(*)::int n from public.billed_results where event_id = $1`, [f.eventId])).rows[0].n as number;

  // The worker's per-row step, from the same exported functions, same order.
  const drainRow = async (row: Row, ctx = wp.createWebhookBatchContext()) => {
    try {
      await wp.processWebhookEvent(row, ctx);
      await wh.markWebhookEventProcessed(row.id);
    } catch (e) {
      await wh.markWebhookEventFailed(row.id, row.attempts + 1, e instanceof Error ? e.message : 'unknown error');
    }
  };

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
  it.fails('KNOWN BUG 3a: a row claimed by drain A is not handed to an overlapping drain B before A finishes', async () => {
    const f = await scope.create();
    const row = await reply(f);
    const first = await wh.claimUnprocessedWebhookEvents(CLAIM_ALL);
    expect(ids(first)).toContain(row.id);
    const second = await wh.claimUnprocessedWebhookEvents(CLAIM_ALL); // A has not processed yet
    expect(ids(second)).not.toContain(row.id);
  });

  it('characterization 3a: claimUnprocessedWebhookEvents returns the same row to both drains (PostgREST ends the lock with the request)', async () => {
    const f = await scope.create();
    const row = await reply(f);
    const [a, b] = await Promise.all([wh.claimUnprocessedWebhookEvents(CLAIM_ALL), wh.claimUnprocessedWebhookEvents(CLAIM_ALL)]);
    const c = await wh.claimUnprocessedWebhookEvents(CLAIM_ALL);
    expect(ids(a)).toContain(row.id);
    expect(ids(b).includes(row.id) || ids(c).includes(row.id)).toBe(true);
    expect(ids(c)).toContain(row.id);
  });

  it('3b: two overlapping drains process the same row — idempotency holds: one charge, one interaction, one RSVP row, processed', async () => {
    const f = await scope.create();
    const row = await reply(f, 'rsvp_declined');
    const a = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id)!;
    const b = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id)!;
    expect(a && b).toBeTruthy();
    await Promise.all([scope.track(drainRow(a)), scope.track(drainRow(b))]);
    expect(await billed(f)).toBe(1);
    const n = await pool.query(
      `select (select count(*)::int from public.contact_interactions where event_id = $1 and direction = 'in') i,
              (select count(*)::int from public.rsvp_responses where guest_id = $2) r`,
      [f.eventId, f.guestId],
    );
    expect(n.rows[0]).toEqual({ i: 1, r: 1 });
    expect((await inboxRow(row.id)).processed_at).not.toBeNull();
    expect(ids(await wh.claimUnprocessedWebhookEvents(CLAIM_ALL))).not.toContain(row.id);
  });

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

  it('characterization 3e: two overlapping drains that both fail count ONE attempt (attempts written from each stale claim snapshot)', async () => {
    const f = await scope.create();
    const row = await reply(f);
    const a = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id)!;
    const b = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id)!;
    await Promise.all([
      wh.markWebhookEventFailed(a.id, a.attempts + 1, 'drain A failed'),
      wh.markWebhookEventFailed(b.id, b.attempts + 1, 'drain B failed'),
    ]);
    expect((await inboxRow(row.id)).attempts).toBe(1);
  });

  it('3f: a late failure from an overlapping drain does not un-process a row the other drain completed', async () => {
    const f = await scope.create();
    const row = await reply(f);
    const a = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id)!;
    const b = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id)!;
    await scope.track(drainRow(a));
    await wh.markWebhookEventFailed(b.id, b.attempts + 1, 'drain B failed late');
    const r = await inboxRow(row.id);
    expect(r.processed_at).not.toBeNull();
    expect(r).toMatchObject({ attempts: 1, last_error: 'drain B failed late' }); // misleading but harmless
    expect(ids(await wh.claimUnprocessedWebhookEvents(CLAIM_ALL))).not.toContain(row.id);
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

  // ── two workers, the first still processing ─────────────────────────────────
  // Deterministic "still processing": connection H holds the fixture GUEST row lock,
  // so drain A blocks inside submit_rsvp (after insertInteraction + recordReached).
  // We wait on the CONDITION "A's backend is blocked by H" (pg_blocking_pids), not on
  // time. Then drain B claims and starts. Nothing in the processing code is mocked.
  // Backends blocked by H directly OR behind a backend that H blocks (A may already
  // hold a lock inside submit_rsvp, so B can queue behind A rather than behind H).
  const blockedBy = async (holderPid: number) =>
    (await pool.query(
      `with recursive chain(pid) as (
         select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
         union
         select s.pid from pg_stat_activity s join chain c on c.pid = any(pg_blocking_pids(s.pid))
       ) select count(*)::int n from chain`,
      [holderPid],
    )).rows[0].n as number;
  const waitChain = async () =>
    (await pool.query(
      `select pid, pg_blocking_pids(pid) blocked_by, left(regexp_replace(query, '\\s+', ' ', 'g'), 80) q
         from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`,
    )).rows;
  const until = async (cond: () => Promise<boolean>, what: string) => {
    const deadline = Date.now() + 15_000;
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  async function overlapWhileProcessing() {
    const f = await scope.create();
    const row = await reply(f, 'rsvp_attending');
    const h = await pool.connect();
    let drains: Promise<unknown>[] = [];
    try {
      await h.query('begin');
      await h.query(`select id from public.guests where id = $1 for update`, [f.guestId]);
      const hPid = (await h.query('select pg_backend_pid() pid')).rows[0].pid as number;

      const a = (await wh.claimUnprocessedWebhookEvents(CLAIM_ALL)).find((r) => r.id === row.id);
      expect(a).toBeDefined();
      drains.push(scope.track(drainRow(a!)));
      await until(async () => (await blockedBy(hPid)) >= 1, 'drain A blocked inside processing');
      const midA = {
        processedAt: (await inboxRow(row.id)).processed_at,
        interactions: (await pool.query(`select count(*)::int n from public.contact_interactions where event_id = $1 and direction = 'in'`, [f.eventId])).rows[0].n,
        billed: await billed(f),
      };

      const second = await wh.claimUnprocessedWebhookEvents(CLAIM_ALL); // worker B, A still running
      const b = second.find((r) => r.id === row.id);
      let chain: Array<Record<string, unknown>> = [];
      if (b) {
        drains.push(scope.track(drainRow(b)));
        await until(async () => (await blockedBy(hPid)) >= 2, 'drain B blocked on the same row');
        chain = await waitChain();
      }
      await h.query('commit'); // release; both drains finish
      await Promise.all(drains);
      drains = [];
      const after = await pool.query(
        `select (select count(*)::int from public.contact_interactions where event_id = $1 and direction = 'in') interactions,
                (select count(*)::int from public.billed_results where event_id = $1) billed,
                (select count(*)::int from public.rsvp_responses where guest_id = $2) responses,
                (select count(*)::int from public.activity_log where event_id = $1 and action = 'rsvp.from_whatsapp') markers,
                (select processed_at is not null from public.webhook_inbox where id = $3) processed`,
        [f.eventId, f.guestId, row.id],
      );
      return { f, row, midA, hPid, chain, bClaimed: Boolean(b), concurrentProcessors: b ? 2 : 1, after: after.rows[0] };
    } finally {
      await h.query('rollback').catch(() => {}); // only if an assertion threw before commit
      await Promise.allSettled(drains);
      h.release();
    }
  }

  it.fails('KNOWN BUG 3g: a second worker does NOT receive an event the first worker is still processing', async () => {
    const r = await overlapWhileProcessing();
    expect(r.bClaimed).toBe(false);
  });

  it('characterization 3g: B claims the event while A is mid-processing; both run it concurrently — idempotency keeps ONE business result', async () => {
    const r = await overlapWhileProcessing();
    // A was really mid-processing: interaction + charge written, row not yet processed
    expect(r.midA).toEqual({ processedAt: null, interactions: 1, billed: 1 });
    // failure to prevent double PROCESSING — reproduced
    expect(r.bClaimed).toBe(true);
    expect(r.concurrentProcessors).toBe(2);
    console.log(`[3g] H pid=${r.hPid}; wait chain while both drains were in flight: ${JSON.stringify(r.chain)}`);
    // …while the idempotency mechanisms prevent a double BUSINESS RESULT:
    //   UNIQUE(channel, provider_id) → one interaction; billed_results UNIQUE → one charge;
    //   submit_rsvp unchanged:true → one rsvp_responses row and one source marker.
    expect(r.after).toEqual({ interactions: 1, billed: 1, responses: 1, markers: 1, processed: true });
  });
});
