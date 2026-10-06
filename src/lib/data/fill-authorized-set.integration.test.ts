import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { resolveTestDb } from '@/lib/outreach/test-db-guard';

const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

describe.skipIf(!RUN)('fill_authorized_set — rollback-isolated', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST!.dbUrl, ssl: { rejectUnauthorized: false }, max: 1, application_name: 'kalfa-fill-it' });
  });
  afterAll(async () => { if (pool) await pool.end(); });

  // guests: [{ contact, seq }] — one row per guest; a contact may have several guests.
  async function run(
    cfg: { quota: number | null; status?: string; removed?: string[]; preMembers?: string[] },
    guests: Array<{ contact: string; seq: number }>,
    fn: (ctx: { event: string; campaign: string; call: () => Promise<Record<string, unknown>>; members: () => Promise<string[]> }) => Promise<void>,
  ) {
    const event = randomUUID();
    const campaign = randomUUID();
    const q = (t: string, v?: unknown[]) => pool.query(t, v);
    await q('begin');
    try {
      await q('set local session_replication_role = replica');
      await q(
        `insert into public.campaigns (id, event_id, status, max_contacts, price_per_reached, base_price, included_reached, contact_quota)
         values ($1,$2,$3,0,0,0,0,$4)`,
        [campaign, event, cfg.status ?? 'approved', cfg.quota],
      );
      // contacts.normalized_phone and guests.full_name are NOT NULL without a default (checked on the live schema).
      let phone = 0;
      for (const id of new Set(guests.map((g) => g.contact))) {
        await q(
          `insert into public.contacts (id, event_id, normalized_phone, removal_requested) values ($1,$2,$3,$4)`,
          [id, event, `+97250000${String(++phone).padStart(4, '0')}`, (cfg.removed ?? []).includes(id)],
        );
      }
      for (const g of guests) {
        await q(
          `insert into public.guests (id, event_id, full_name, contact_id, seq) values ($1,$2,'Test Guest',$3,$4)`,
          [randomUUID(), event, g.contact, g.seq],
        );
      }
      for (const id of cfg.preMembers ?? []) {
        await q(`insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id) values ($1,$2,$3)`, [event, campaign, id]);
      }
      await fn({
        event,
        campaign,
        call: async () => (await q(`select public.fill_authorized_set($1,$2,'it') as r`, [event, campaign])).rows[0].r as Record<string, unknown>,
        members: async () => (await q(`select contact_id from public.campaign_authorized_contacts where campaign_id=$1`, [campaign])).rows.map((r) => r.contact_id as string),
      });
    } finally {
      await q('rollback');
    }
  }

  const A = randomUUID(), B = randomUUID(), C = randomUUID(), D = randomUUID();

  it('admits the first contacts by seq up to the quota; the rest wait', async () => {
    await run({ quota: 2 }, [{ contact: C, seq: 3 }, { contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: D, seq: 4 }], async (x) => {
      expect(await x.call()).toEqual({ verdict: 'filled', admitted: 2, size: 2, quota: 2, waiting: 2 });
      expect((await x.members()).sort()).toEqual([A, B].sort());
    });
  });

  it('ranks a contact by the SMALLEST seq among its guests', async () => {
    await run({ quota: 1 }, [{ contact: A, seq: 5 }, { contact: B, seq: 2 }, { contact: A, seq: 1 }], async (x) => {
      await x.call();
      expect(await x.members()).toEqual([A]);
    });
  });

  it('fewer eligible than the quota: admits all, nobody waits', async () => {
    await run({ quota: 10 }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }], async (x) => {
      expect(await x.call()).toMatchObject({ admitted: 2, size: 2, waiting: 0 });
    });
  });

  it('never removes a member and keeps a swap: a pre-existing member outside the first N stays, and takes its seat', async () => {
    await run({ quota: 2, preMembers: [D] }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: D, seq: 9 }], async (x) => {
      expect(await x.call()).toMatchObject({ admitted: 1, size: 2 });
      expect((await x.members()).sort()).toEqual([A, D].sort());
    });
  });

  it('is idempotent: a second call admits nobody', async () => {
    await run({ quota: 2 }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: C, seq: 3 }], async (x) => {
      await x.call();
      expect(await x.call()).toMatchObject({ admitted: 0, size: 2, waiting: 1 });
    });
  });

  it('skips a contact that asked to be removed', async () => {
    await run({ quota: 2, removed: [A] }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: C, seq: 3 }], async (x) => {
      await x.call();
      expect((await x.members()).sort()).toEqual([B, C].sort());
    });
  });

  it('quota 0 admits nobody', async () => {
    await run({ quota: 0 }, [{ contact: A, seq: 1 }], async (x) => {
      expect(await x.call()).toMatchObject({ admitted: 0, size: 0, waiting: 1 });
    });
  });

  it.each([
    ['no quota', { quota: null }, 'no_quota'],
    ['a campaign that is not operational', { quota: 5, status: 'pending_approval' }, 'not_operational'],
  ])('answers %s with its verdict and writes nothing', async (_l, cfg, verdict) => {
    await run(cfg, [{ contact: A, seq: 1 }], async (x) => {
      expect(await x.call()).toEqual({ verdict });
      expect(await x.members()).toEqual([]);
    });
  });

  it('refuses a campaign of another event', async () => {
    await run({ quota: 5 }, [{ contact: A, seq: 1 }], async (x) => {
      const r = (await pool.query(`select public.fill_authorized_set($1,$2,'it') as r`, [randomUUID(), x.campaign])).rows[0].r;
      expect(r).toEqual({ verdict: 'event_mismatch' });
    });
  });

  it('writes one audit row per admission (action in, reason snapshot) with the growing size', async () => {
    await run({ quota: 2 }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }], async (x) => {
      await x.call();
      const rows = (await pool.query(
        `select action, reason, actor, resulting_size from public.campaign_authorized_set_audit where campaign_id=$1 order by resulting_size`,
        [x.campaign],
      )).rows;
      expect(rows).toEqual([
        { action: 'in', reason: 'snapshot', actor: 'it', resulting_size: 1 },
        { action: 'in', reason: 'snapshot', actor: 'it', resulting_size: 2 },
      ]);
    });
  });
});
