// PROBE — not a regular test file. Collected ONLY when KALFA_IT_PROBE is set
// (vitest.integration.config.mts), by cleanup.local-it.test.ts, which runs it in a
// child Vitest process and then checks the database from the outside.
//
// Each mode makes the REAL webhook code write committed rows through PostgREST and
// then ends badly. Every fixture id is appended to the manifest BEFORE it is
// inserted, so the parent can look for residue by id.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type Fixture,
  FixtureScope,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from './local-integration';

const MODE = process.env.KALFA_IT_PROBE ?? '';
const MANIFEST = process.env.KALFA_IT_PROBE_MANIFEST ?? '';
const ENV = requireLocalIntegrationEnv();
if (!MANIFEST) throw new Error('probe: KALFA_IT_PROBE_MANIFEST is required');

const log = (o: Record<string, unknown>) => appendFileSync(MANIFEST, `${JSON.stringify(o)}\n`);

type Row = Parameters<typeof import('@/lib/data/webhook-processing').processWebhookEvent>[0];
let pool: Pool;
let scope: FixtureScope;
let processRow: (row: Row) => Promise<void>;

beforeAll(async () => {
  useLocalAdminEnv(ENV);
  pool = newPool(ENV, `probe-${MODE}`, 6);
  scope = new FixtureScope(pool, (f) => log({ fixture: f }));
  const wp = await import('@/lib/data/webhook-processing');
  processRow = (row) => wp.processWebhookEvent(row, wp.createWebhookBatchContext());
});

afterAll(async () => {
  try {
    await scope.cleanup();
    log({ cleaned: true });
  } finally {
    await pool.end();
  }
});

// A guest's reply to the outbound template: the real code inserts the inbound
// interaction and bills it (billed_results — a RESTRICT FK onto the fixture).
async function realWrites(f: Fixture): Promise<Row> {
  const row = (await scope.insertInbox(f, {
    messageId: `wamid.${f.tag}.${randomUUID().slice(0, 6)}`,
    payload: { type: 'text', from: f.phone.replace('+', ''), text: { body: 'תודה' } },
    contextId: f.outboundWamid,
  })) as Row;
  await scope.track(processRow(row));
  const n = (await pool.query(`select count(*)::int n from public.billed_results where event_id = $1`, [f.eventId])).rows[0].n;
  log({ wrote: f.tag, billed: n });
  return row;
}

describe.runIf(MODE === 'fail')('probe: assertion failure', () => {
  it('fails after the code under test committed rows', async () => {
    await realWrites(await scope.create());
    expect('state after the run').toBe('something else');
  });
});

describe.runIf(MODE === 'throw')('probe: exceptions', () => {
  it('throws after the code under test committed rows', async () => {
    await realWrites(await scope.create());
    throw new Error('probe: thrown on purpose');
  });

  it('a fixture whose creation fails half-way (ids registered, insert rolled back on its own connection)', async () => {
    await scope.create({ campaignStatus: 'bogus' as 'active' });
  });
});

describe.runIf(MODE === 'concurrent').concurrent('probe: concurrent tests', () => {
  for (const i of [1, 2, 3, 4]) {
    it(`worker ${i}`, async () => {
      const f = await scope.create();
      const row = await realWrites(f);
      await Promise.all([scope.track(processRow(row)), scope.track(processRow(row))]);
      if (i === 2) expect(i).toBe(0);
      if (i === 4) {
        // Leave real work in flight and fail immediately: cleanup must wait for it.
        const late = (await scope.insertInbox(f, {
          messageId: `wamid.${f.tag}.late`,
          payload: { type: 'button', from: f.phone.replace('+', ''), button: { payload: 'rsvp_declined', text: 'x' } },
          contextId: f.outboundWamid,
        })) as Row;
        void scope.track(processRow(late));
        throw new Error('probe: failed with work in flight');
      }
    });
  }
});

describe.runIf(MODE === 'hang')('probe: killed mid-test', () => {
  it('hangs after committed writes until the parent SIGKILLs the process group', async () => {
    await realWrites(await scope.create());
    log({ ready: true });
    await new Promise(() => {});
  }, 300_000);
});
