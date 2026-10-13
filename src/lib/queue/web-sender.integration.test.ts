import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { PgBoss } from 'pg-boss';
import { Pool } from 'pg';

vi.mock('server-only', () => ({}));

import { resolveTestDb, testDbSsl } from '@/lib/outreach/test-db-guard';
import { createWebJobSender, webSenderOptions } from './web-sender';

// ─────────────────────────────────────────────────────────────────────────────
// The web tier's pg-boss sender is ONE connection (web-sender.ts). This drives the
// real thing — the real options, the real pg-boss — against a disposable schema
// and proves that serialising every send through that one connection loses none.
//
// Same gate as pgboss-isolation.integration.test.ts: OUTREACH_DB_IT=1 plus the
// OUTREACH_TEST_* trio, which resolveTestDb() refuses to accept if it points at
// the production project. Only a schema of its own is created and dropped; the
// real `pgboss` schema is never read or written.
// ─────────────────────────────────────────────────────────────────────────────
const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

const QUEUE = 'web-sender-stress';
const SENDER_APP = 'kalfa-web-sender';

describe.skipIf(!RUN)('web sender — one connection, no lost send', () => {
  let schema: string;
  let owner: PgBoss; // plays the worker: owns and creates the schema
  let sender: PgBoss;
  let pool: Pool;

  beforeEach(async () => {
    schema = `pgboss_test_${randomUUID().replace(/-/g, '')}`;
    const url = new URL(TEST!.dbUrl);
    const ssl = testDbSsl(TEST!.dbUrl);

    pool = new Pool({ connectionString: TEST!.dbUrl, ssl, max: 2, application_name: 'kalfa-web-sender-it' });
    owner = new PgBoss({ connectionString: TEST!.dbUrl, ssl, schema });
    owner.on('error', () => {});
    await owner.start(); // creates the isolated schema, as the worker does in production
    await owner.createQueue(QUEUE);

    // The production options, pointed at the disposable schema.
    sender = await createWebJobSender({
      ...webSenderOptions({
        SUPABASE_DB_HOST: url.hostname,
        SUPABASE_DB_PORT: url.port,
        SUPABASE_DB_USER: decodeURIComponent(url.username),
        SUPABASE_DB_PASSWORD: decodeURIComponent(url.password),
        SUPABASE_DB_NAME: url.pathname.slice(1),
      }),
      schema,
      ssl,
    });
    sender.on('error', () => {});
  });

  afterEach(async () => {
    try {
      await sender.stop({ graceful: false });
      await owner.stop({ graceful: false });
    } finally {
      await pool.query(`drop schema if exists ${schema} cascade`);
      // Our own schema only: another integration file may be running its own
      // disposable schema at this moment (vitest runs files in parallel).
      const leftover = await pool.query(`select nspname from pg_namespace where nspname = $1`, [schema]);
      expect(leftover.rows).toHaveLength(0);
      await pool.end();
    }
  });

  it('200 parallel sends are all written, each exactly once', async () => {
    const N = 200;
    const ids = await Promise.all(Array.from({ length: N }, (_, i) => sender.send(QUEUE, { i })));

    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(N);

    const { rows } = await pool.query(
      `select count(*)::int as rows, count(distinct data->>'i')::int as payloads
         from ${schema}.job where name = $1`,
      [QUEUE],
    );
    expect(rows[0]).toEqual({ rows: N, payloads: N });
  });

  it('holds one database connection for the whole burst, never two', async () => {
    const peak = { value: 0 };
    let sending = true;
    const sampler = (async () => {
      while (sending) {
        const { rows } = await pool.query(
          `select count(*)::int as n from pg_stat_activity where application_name = $1`,
          [SENDER_APP],
        );
        peak.value = Math.max(peak.value, rows[0].n);
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();

    await Promise.all(Array.from({ length: 200 }, (_, i) => sender.send(QUEUE, { i })));
    sending = false;
    await sampler;

    expect(peak.value).toBe(1);
  });
});
