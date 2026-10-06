import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { resolveTestDb } from '@/lib/outreach/test-db-guard';

// guests.seq must increase in the order rows are produced by ONE multi-row insert (what a bulk import is).
// Gated like reconcile.integration.test.ts: a TEST-ONLY database, never the linked prod project.
const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

describe.skipIf(!RUN)('guests.seq — rollback-isolated', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: TEST!.dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 1,
      application_name: 'kalfa-guests-seq-it',
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('a multi-row insert gets strictly increasing seq in row order', async () => {
    const q = (t: string, v?: unknown[]) => pool.query(t, v);
    await q('begin');
    try {
      await q('set local session_replication_role = replica');
      const event = randomUUID();
      const res = await q(
        `insert into public.guests (id, event_id, full_name)
         select gen_random_uuid(), $1, 'g' || n from generate_series(1, 25) n
         returning full_name, seq`,
        [event],
      );
      const seqs = res.rows.map((r: { seq: string }) => Number(r.seq));
      expect(seqs).toHaveLength(25);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      expect(res.rows.map((r: { full_name: string }) => r.full_name)).toEqual(
        Array.from({ length: 25 }, (_, i) => `g${i + 1}`),
      );
    } finally {
      await q('rollback');
    }
  });
});
