import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { resolveTestDb } from '@/lib/outreach/test-db-guard';

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
      ssl: { rejectUnauthorized: false },
      max: 1,
      application_name: 'kalfa-reconcile-it',
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // Seed a campaign, run `fn`, ALWAYS roll back. replica → FK/triggers off, so
  // no real event chain is needed; reconcile only reads campaigns/contacts/guests
  // and writes campaign_authorized_contacts + the audit.
  async function withCampaign(
    cfg: {
      max: number;
      auth: number | null;
      price: number | null;
      status?: string;
      // Omitted → both null → coalesced to 0 in the RPC → legacy formula
      // (funded_cap = floor(auth/price)), unchanged from before this fix.
      base?: number;
      included?: number;
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
        `insert into public.campaigns
           (id, event_id, status, max_contacts, auth_amount, price_per_reached, base_price, included_reached)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          campaign,
          event,
          cfg.status ?? 'active',
          cfg.max,
          cfg.auth,
          cfg.price,
          cfg.base ?? null,
          cfg.included ?? null,
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
    await withCampaign({ max: 10, auth: 40, price: 4 }, async ({ event, campaign, q }) => {
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

  it('add: eligible contact under funded_cap → added + one in/add audit row', async () => {
    await withCampaign({ max: 10, auth: 40, price: 4 }, async ({ event, campaign, q }) => {
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

  it('add: at funded_cap = least(max_contacts, floor(auth/price)) → ceiling_full', async () => {
    // funded_cap = min(1, floor(4/4)) = 1
    await withCampaign({ max: 1, auth: 4, price: 4 }, async ({ event, campaign, q }) => {
      const c1 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null])).toBe('added');
      const c2 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c2, null, null])).toBe(
        'ceiling_full',
      );
      expect(await setSize(q, campaign)).toBe(1);
    });
  });

  it('base+overage: funded_cap = included + floor(max(0,auth-base)/price), not floor(auth/price)', async () => {
    // Fix under test (30.8): base=200, included=200, price=4, auth=200 (a
    // fully-funded hold with zero overage headroom) — the OLD formula gave
    // floor(200/4)=50, rejecting real contacts the base fee already covers.
    // The fix: 200 + floor(max(0,200-200)/4) = 200.
    await withCampaign(
      { max: 1000, auth: 200, price: 4, base: 200, included: 200 },
      async ({ event, campaign, q }) => {
        // Admit 200 contacts — every one must succeed under the fixed cap.
        for (let i = 0; i < 200; i++) {
          const c = await eligibleContact(q, event);
          expect(
            await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null]),
          ).toBe('added');
        }
        expect(await setSize(q, campaign)).toBe(200);
        // The 201st (beyond the fully-funded 200-included, zero overage room) → ceiling_full.
        const over = await eligibleContact(q, event);
        expect(
          await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', over, null, null]),
        ).toBe('ceiling_full');
        expect(await setSize(q, campaign)).toBe(200);
      },
    );
  });

  it('base+overage: extra overage headroom beyond auth-base is admitted too', async () => {
    // base=200, included=200, price=4, auth=240 → 40 of headroom beyond the
    // base buys 10 more contacts: funded_cap = 200 + floor((240-200)/4) = 210.
    await withCampaign(
      { max: 1000, auth: 240, price: 4, base: 200, included: 200 },
      async ({ event, campaign, q }) => {
        for (let i = 0; i < 210; i++) {
          const c = await eligibleContact(q, event);
          expect(
            await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null]),
          ).toBe('added');
        }
        const over = await eligibleContact(q, event);
        expect(
          await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', over, null, null]),
        ).toBe('ceiling_full');
      },
    );
  });

  it('base+overage: max_contacts frozen at 0 (signed before adding guests) still admits up to `included`', async () => {
    // Fix under test (2.9): max_contacts is persisted at HOLD time as the
    // unique-contact count. A customer who signs + holds before adding guests
    // (allowed since 26.7) therefore gets max_contacts=0, and the OLD cap
    // least(0, 200 + floor(0/4)) = 0 rejected EVERY later guest — an "active"
    // campaign that never sends (one live campaign was in exactly this state).
    // The base fee already covers `included` contacts, so the cap must never
    // fall below it: least(greatest(0, 200), 200) = 200.
    await withCampaign(
      { max: 0, auth: 200, price: 4, base: 200, included: 200 },
      async ({ event, campaign, q }) => {
        const c = await eligibleContact(q, event);
        expect(
          await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null]),
        ).toBe('added');
        expect(await setSize(q, campaign)).toBe(1);
      },
    );
  });

  it('legacy (base=0/included=0): max_contacts still caps exactly as before', async () => {
    // greatest(max, 0) = max → identical to the pre-fix formula for every
    // campaign created before the base+overage gate went live.
    await withCampaign({ max: 1, auth: 40, price: 4 }, async ({ event, campaign, q }) => {
      const c1 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null])).toBe(
        'added',
      );
      const c2 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c2, null, null])).toBe(
        'ceiling_full',
      );
      expect(await setSize(q, campaign)).toBe(1);
    });
  });

  it('funded_cap FAIL-CLOSED: null price → cap 0 → ceiling_full even for the first add', async () => {
    await withCampaign({ max: 10, auth: 40, price: null }, async ({ event, campaign, q }) => {
      const c = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null])).toBe(
        'ceiling_full',
      );
    });
  });

  it('repoint to the SAME contact → noop (fast-path, no set/audit churn)', async () => {
    await withCampaign({ max: 10, auth: 40, price: 4 }, async ({ event, campaign, q }) => {
      const c = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'repoint', c, c, null])).toBe('noop');
      expect(await setSize(q, campaign)).toBe(0);
    });
  });

  it('delete: not-exposed member → removed; exposed member → pinned_kept (stays in set)', async () => {
    await withCampaign({ max: 10, auth: 40, price: 4 }, async ({ event, campaign, q }) => {
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
    await withCampaign({ max: 10, auth: 40, price: 4 }, async ({ event, campaign, q }) => {
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
});
