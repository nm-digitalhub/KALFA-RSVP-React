import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { resolveTestDb, testDbSsl } from '@/lib/outreach/test-db-guard';

// P0-1 integration: reconcile_authorized_set verdicts + the exposure-based pin,
// against the applied public schema, ROLLBACK-isolated. Each case runs inside a
// transaction with `session_replication_role=replica` (FK + triggers skipped) so
// synthetic campaign/contact/guest rows suffice and nothing persists.
//
// GATED (same guard as the serial-flow suite): OUTREACH_DB_IT=1 + a TEST-ONLY DB
// via resolveTestDb() (OUTREACH_TEST_DB_URL / *_SUPABASE_URL / *_SERVICE_ROLE_KEY),
// which HARD-FAILS if pointed at prod. Run against `supabase start` (local) or a
// dedicated test DB — NEVER the linked prod project. Unset → skipped.
const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

type Row = Record<string, unknown>;

describe.skipIf(!RUN)('reconcile_authorized_set — rollback-isolated', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: TEST!.dbUrl,
      ssl: testDbSsl(TEST!.dbUrl),
      max: 1,
      application_name: 'kalfa-reconcile-it',
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // Seed a campaign, run `fn`, ALWAYS roll back. replica → FK/triggers off, so
  // no real event chain is needed; reconcile reads campaigns/contacts/guests (plus
  // the exposure tables behind the pin check) and writes
  // campaign_authorized_contacts + the audit.
  async function withCampaign(
    cfg: {
      max: number;
      status?: string;
      // campaigns.contact_quota (the package quota). Omitted → NULL → no limit.
      quota?: number;
    },
    fn: (ctx: {
      event: string;
      campaign: string;
      q: (t: string, v?: unknown[]) => Promise<{ rows: Row[] }>;
    }) => Promise<void>,
  ): Promise<void> {
    const event = randomUUID();
    const campaign = randomUUID();
    const q = (t: string, v?: unknown[]) => pool.query(t, v);
    await q('begin');
    try {
      await q('set local session_replication_role = replica');
      await q(
        `insert into public.campaigns (id, event_id, status, max_contacts, contact_quota)
         values ($1,$2,$3,$4,$5)`,
        [
          campaign,
          event,
          cfg.status ?? 'active',
          cfg.max,
          cfg.quota ?? null,
        ],
      );
      await fn({ event, campaign, q });
    } finally {
      await q('rollback');
    }
  }

  const rpc = async (
    q: (t: string, v?: unknown[]) => Promise<{ rows: Row[] }>,
    fn: string,
    args: unknown[],
  ): Promise<string> => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    const res = await q(`select public.${fn}(${ph}) as r`, args);
    return String(res.rows[0].r);
  };

  // An eligible admit target: contact of THIS event, not opted out, with a live guest.
  async function eligibleContact(
    q: (t: string, v?: unknown[]) => Promise<{ rows: Row[] }>,
    event: string,
  ): Promise<string> {
    const contact = randomUUID();
    await q(
      `insert into public.contacts (id, event_id, normalized_phone, removal_requested)
       values ($1,$2,$3,false)`,
      [contact, event, '+9725' + Math.floor(Math.random() * 1e7)],
    );
    await q(
      `insert into public.guests (id, event_id, full_name, contact_id)
       values ($1,$2,'Test Guest',$3)`,
      [randomUUID(), event, contact],
    );
    return contact;
  }

  const setSize = async (
    q: (t: string, v?: unknown[]) => Promise<{ rows: Row[] }>,
    campaign: string,
  ): Promise<number> =>
    q(
      `select count(*)::int c from public.campaign_authorized_contacts where campaign_id=$1`,
      [campaign],
    ).then((r) => Number(r.rows[0].c));

  it('add: a contact with no live guest → not_eligible, never admitted', async () => {
    await withCampaign({ max: 10 }, async ({ event, campaign, q }) => {
      const contact = randomUUID();
      await q(
        `insert into public.contacts (id, event_id, normalized_phone, removal_requested)
         values ($1,$2,'+972500000001',false)`,
        [contact, event],
      );
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', contact, null, null])).toBe(
        'not_eligible',
      );
      expect(await setSize(q, campaign)).toBe(0);
    });
  });

  it('add: eligible contact → added + one in/add audit row', async () => {
    await withCampaign({ max: 10 }, async ({ event, campaign, q }) => {
      const contact = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', contact, null, null])).toBe(
        'added',
      );
      expect(await setSize(q, campaign)).toBe(1);
      const a = await q(
        `select action, reason from public.campaign_authorized_set_audit where campaign_id=$1`,
        [campaign],
      );
      expect(a.rows).toHaveLength(1);
      expect(a.rows[0]).toMatchObject({ action: 'in', reason: 'add' });
    });
  });

  it('add: beyond max_contacts → still added (max_contacts caps nothing)', async () => {
    await withCampaign({ max: 1 }, async ({ event, campaign, q }) => {
      const c1 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null])).toBe('added');
      const c2 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c2, null, null])).toBe(
        'added',
      );
      expect(await setSize(q, campaign)).toBe(2);
    });
  });

  it('max_contacts frozen at 0 (terms approved before adding guests) still admits', async () => {
    await withCampaign({ max: 0 }, async ({ event, campaign, q }) => {
      const c = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null])).toBe('added');
      expect(await setSize(q, campaign)).toBe(1);
    });
  });

  it('repoint to the SAME contact → noop (fast-path, no set/audit churn)', async () => {
    await withCampaign({ max: 10 }, async ({ event, campaign, q }) => {
      const c = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'repoint', c, c, null])).toBe('noop');
      expect(await setSize(q, campaign)).toBe(0);
    });
  });

  it('delete: not-exposed member → removed; exposed member → pinned_kept (stays in set)', async () => {
    await withCampaign({ max: 10 }, async ({ event, campaign, q }) => {
      const c = await eligibleContact(q, event);
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null]);

      // not exposed → removed
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'delete', c, null, null])).toBe(
        'removed',
      );
      expect(await setSize(q, campaign)).toBe(0);

      // re-add, then mark serviced (call_request_count>0) → has_service_exposure → pinned
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null]);
      await q(
        `insert into public.outreach_state (id, event_id, campaign_id, contact_id, call_request_count)
         values ($1,$2,$3,$4,1)`,
        [randomUUID(), event, campaign, c],
      );
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'delete', c, null, null])).toBe(
        'pinned_kept',
      );
      expect(await setSize(q, campaign)).toBe(1);
    });
  });

  it('repoint A→B, A not-exposed → swap (A out, B in, size constant)', async () => {
    await withCampaign({ max: 10 }, async ({ event, campaign, q }) => {
      const a = await eligibleContact(q, event);
      const b = await eligibleContact(q, event);
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', a, null, null]);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'repoint', b, a, null])).toBe(
        'swapped',
      );
      const inSet = async (c: string) =>
        q(
          `select count(*)::int c from public.campaign_authorized_contacts where campaign_id=$1 and contact_id=$2`,
          [campaign, c],
        ).then((r) => Number(r.rows[0].c));
      expect(await inSet(a)).toBe(0);
      expect(await inSet(b)).toBe(1);
    });
  });

  // ── contact-quota package (migration 20261004082517; plan 2026-09-30-contact-quota-package.md) ──
  // The cap is on ADMISSION to the list. A campaign without a quota is covered by every case above
  // (quota omitted → NULL).

  it('quota: the list fills to the quota, then the next add → quota_full (no row, no audit)', async () => {
    await withCampaign({ max: 10, quota: 2 }, async ({ event, campaign, q }) => {
      const [c1, c2, c3] = [
        await eligibleContact(q, event),
        await eligibleContact(q, event),
        await eligibleContact(q, event),
      ];
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null])).toBe('added');
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c2, null, null])).toBe('added');
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c3, null, null])).toBe(
        'quota_full',
      );
      expect(await setSize(q, campaign)).toBe(2);
      const a = await q(
        `select count(*)::int c from public.campaign_authorized_set_audit where campaign_id=$1`,
        [campaign],
      );
      expect(Number(a.rows[0].c)).toBe(2);
    });
  });

  it('quota: a contact already on a full list → noop, not quota_full', async () => {
    await withCampaign({ max: 10, quota: 1 }, async ({ event, campaign, q }) => {
      const c1 = await eligibleContact(q, event);
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null]);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null])).toBe('noop');
    });
  });

  it('quota: an ineligible contact is not_eligible even when the list is full (eligibility is checked first)', async () => {
    await withCampaign({ max: 10, quota: 1 }, async ({ event, campaign, q }) => {
      const c1 = await eligibleContact(q, event);
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null]);
      const orphan = randomUUID();
      await q(
        `insert into public.contacts (id, event_id, normalized_phone, removal_requested)
         values ($1,$2,'+972500000002',false)`,
        [orphan, event],
      );
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', orphan, null, null])).toBe(
        'not_eligible',
      );
    });
  });

  it('quota: removing a not-exposed member frees the seat for the next add', async () => {
    await withCampaign({ max: 10, quota: 1 }, async ({ event, campaign, q }) => {
      const [c1, c2] = [await eligibleContact(q, event), await eligibleContact(q, event)];
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null]);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c2, null, null])).toBe(
        'quota_full',
      );
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'delete', c1, null, null])).toBe(
        'removed',
      );
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c2, null, null])).toBe('added');
      expect(await setSize(q, campaign)).toBe(1);
    });
  });

  it('quota: repoint where the old contact was never on a full list → quota_full', async () => {
    await withCampaign({ max: 10, quota: 1 }, async ({ event, campaign, q }) => {
      const [onList, oldC, newC] = [
        await eligibleContact(q, event),
        await eligibleContact(q, event),
        await eligibleContact(q, event),
      ];
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', onList, null, null]);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'repoint', newC, oldC, null])).toBe(
        'quota_full',
      );
      expect(await setSize(q, campaign)).toBe(1);
    });
  });

  it('quota: a swap that removes the not-exposed old contact is NOT capped (size stays constant)', async () => {
    await withCampaign({ max: 10, quota: 1 }, async ({ event, campaign, q }) => {
      const [a, b] = [await eligibleContact(q, event), await eligibleContact(q, event)];
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', a, null, null]);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'repoint', b, a, null])).toBe('swapped');
      expect(await setSize(q, campaign)).toBe(1);
    });
  });

  it('quota: repoint with an EXPOSED old contact on a full list → quota_full, old stays, old audited as kept_exposed', async () => {
    await withCampaign({ max: 10, quota: 1 }, async ({ event, campaign, q }) => {
      const [a, b] = [await eligibleContact(q, event), await eligibleContact(q, event)];
      await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', a, null, null]);
      await q(
        `insert into public.outreach_state (id, event_id, campaign_id, contact_id, call_request_count)
         values ($1,$2,$3,$4,1)`,
        [randomUUID(), event, campaign, a],
      );
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'repoint', b, a, null])).toBe(
        'quota_full',
      );
      // Without the cap this would have been 'pinned_and_added' with a list of two.
      expect(await setSize(q, campaign)).toBe(1);
      const k = await q(
        `select count(*)::int c from public.campaign_authorized_set_audit
         where campaign_id=$1 and action='kept_exposed' and contact_id=$2`,
        [campaign, a],
      );
      expect(Number(k.rows[0].c)).toBe(1);
    });
  });

  it('quota: a quota of 0 admits nobody', async () => {
    await withCampaign({ max: 10, quota: 0 }, async ({ event, campaign, q }) => {
      const c = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null])).toBe('quota_full');
      expect(await setSize(q, campaign)).toBe(0);
    });
  });
});
