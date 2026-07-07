import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { resolveTestDb } from '@/lib/outreach/test-db-guard';

// ─────────────────────────────────────────────────────────────────────────────
// §12 FINAL — serial-flow RPC integration (§8/§11.11). Exercises the FOUR applied
// SECURITY-INVOKER RPCs against the LIVE public schema, but with ZERO persistent
// footprint: every logic test runs inside a transaction that is ALWAYS ROLLED
// BACK, with `session_replication_role=replica` so FK/triggers are skipped and a
// single synthetic outreach_state row (random UUIDs) suffices. One additional
// case makes the literal `createAdminClient().rpc('record_step_plan')` PostgREST
// call to prove the service_role EXECUTE grant + INVOKER end-to-end — it targets
// a non-existent row (→ 'missing'), so it writes nothing and needs no cleanup.
//
// GATED: requires a TEST-ONLY trio (OUTREACH_TEST_DB_URL / OUTREACH_TEST_SUPABASE_URL
// / OUTREACH_TEST_SERVICE_ROLE_KEY) via test-db-guard, which HARD-FAILS if pointed
// at the production project (.env.local URL/host or the prod ref). NEVER the linked
// prod DB. Allowed: Supabase local or a dedicated test DB. The PostgREST rpc probe
// builds its OWN client from the test URL/key (not the app's createAdminClient,
// which is hardwired to the prod env).
// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH_DB_IT=1 is the opt-in; when set, resolveTestDb() THROWS immediately if
// the OUTREACH_TEST_* trio is missing OR points at prod → fail-fast at module load
// (never a silent skip). Unset → tests skip.
const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

type Row = Record<string, unknown>;

describe.skipIf(!RUN)('serial-flow RPCs — test/local schema, rollback-isolated', () => {
  let pool: Pool;

  beforeAll(() => {
    // max:1 → sequential queries share ONE backend connection, so BEGIN/ROLLBACK
    // wraps the whole test deterministically (no cross-connection leakage).
    pool = new Pool({
      connectionString: TEST!.dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 1,
      application_name: 'kalfa-serial-flow-it',
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // Seed a synthetic active cursor row at step 0, then run `fn` and ALWAYS roll
  // back. FK/triggers are disabled for the txn so no real event/campaign/contact
  // is needed — the RPCs only touch outreach_state + activity_log.
  async function withRow(
    seed: { step?: number },
    fn: (ctx: {
      campaign: string;
      contact: string;
      event: string;
      q: (text: string, values?: unknown[]) => Promise<{ rows: Row[] }>;
    }) => Promise<void>,
  ): Promise<void> {
    const campaign = randomUUID();
    const contact = randomUUID();
    const event = randomUUID();
    const q = (text: string, values?: unknown[]) => pool.query(text, values);
    await q('begin');
    try {
      await q('set local session_replication_role = replica'); // skip FK + triggers
      await q(
        `insert into public.outreach_state
           (id, event_id, campaign_id, contact_id, status, current_step_index)
         values ($1,$2,$3,$4,'active',$5)`,
        [randomUUID(), event, campaign, contact, seed.step ?? 0],
      );
      await fn({ campaign, contact, event, q });
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

  const anchor = (q: (t: string, v?: unknown[]) => Promise<{ rows: Row[] }>, camp: string, contact: string) =>
    q(
      `select current_step_index, status, plan_rev, planned_at, dispatched_job_id, dispatched_at
         from public.outreach_state where campaign_id=$1 and contact_id=$2`,
      [camp, contact],
    ).then((r) => r.rows[0]);

  const SLOT_A = '2026-07-13T08:00:00.000Z';
  const SLOT_B = '2026-07-13T09:30:00.000Z';
  const SLOT_C = '2026-07-13T10:15:00.000Z';
  const PR = 'a'.repeat(64);

  it('record_step_plan CAS is on plan_rev AND planned_at — an old-slot re-plan under the SAME planRev is stale', async () => {
    await withRow({ step: 0 }, async ({ campaign, contact, q }) => {
      // initial: expected (null, null) → recorded.
      expect(await rpc(q, 'record_step_plan', [campaign, contact, 0, null, null, PR, SLOT_A])).toBe('recorded');
      let a = await anchor(q, campaign, contact);
      expect(a.plan_rev).toBe(PR);
      expect(new Date(a.planned_at as string).toISOString()).toBe(SLOT_A);

      // A stale job holding the OLD slot but the SAME planRev must NOT overwrite:
      // expected planned_at = SLOT_B (wrong; current is SLOT_A) → stale.
      expect(await rpc(q, 'record_step_plan', [campaign, contact, 0, PR, SLOT_B, PR, SLOT_C])).toBe('stale');
      a = await anchor(q, campaign, contact);
      expect(new Date(a.planned_at as string).toISOString()).toBe(SLOT_A); // unchanged

      // The current holder (expected SLOT_A) legally re-plans to SLOT_B.
      expect(await rpc(q, 'record_step_plan', [campaign, contact, 0, PR, SLOT_A, PR, SLOT_B])).toBe('recorded');
      a = await anchor(q, campaign, contact);
      expect(new Date(a.planned_at as string).toISOString()).toBe(SLOT_B);
    });
  });

  it('record_step_plan on a moved CURSOR is stale (never advances the wrong step)', async () => {
    await withRow({ step: 1 }, async ({ campaign, contact, q }) => {
      // expected_step=0 but the cursor is at 1 → stale.
      expect(await rpc(q, 'record_step_plan', [campaign, contact, 0, null, null, PR, SLOT_A])).toBe('stale');
    });
  });

  it('reserve guards: needs a matching anchor; a second reserve or a wrong slot is stale', async () => {
    await withRow({ step: 0 }, async ({ campaign, contact, q }) => {
      const J1 = randomUUID();
      const J2 = randomUUID();
      // no anchor yet → reserve is stale.
      expect(await rpc(q, 'reserve_outreach_step', [campaign, contact, 0, PR, SLOT_A, J1])).toBe('stale');
      // record the anchor, then reserve succeeds ONCE.
      expect(await rpc(q, 'record_step_plan', [campaign, contact, 0, null, null, PR, SLOT_A])).toBe('recorded');
      expect(await rpc(q, 'reserve_outreach_step', [campaign, contact, 0, PR, SLOT_A, J1])).toBe('reserved');
      const a = await anchor(q, campaign, contact);
      expect(a.dispatched_job_id).toBe(J1);
      expect(a.dispatched_at).not.toBeNull();
      // a concurrent job (reservation held) → stale; a wrong slot → stale.
      expect(await rpc(q, 'reserve_outreach_step', [campaign, contact, 0, PR, SLOT_A, J2])).toBe('stale');
      expect(await rpc(q, 'reserve_outreach_step', [campaign, contact, 0, PR, SLOT_B, J1])).toBe('stale');
    });
  });

  it('resolve advances the cursor once and clears the anchor + reservation atomically', async () => {
    await withRow({ step: 0 }, async ({ campaign, contact, event, q }) => {
      const J = randomUUID();
      await rpc(q, 'record_step_plan', [campaign, contact, 0, null, null, PR, SLOT_A]);
      await rpc(q, 'reserve_outreach_step', [campaign, contact, 0, PR, SLOT_A, J]);
      const audit = randomUUID();
      expect(
        await rpc(q, 'resolve_outreach_step', [campaign, contact, 0, PR, J, true, null, 'sent', event, audit]),
      ).toBe('resolved');
      const a = await anchor(q, campaign, contact);
      expect(a.current_step_index).toBe(1); // advanced
      expect(a.plan_rev).toBeNull();
      expect(a.planned_at).toBeNull();
      expect(a.dispatched_job_id).toBeNull(); // reservation cleared
      expect(a.dispatched_at).toBeNull();
    });
  });

  it('resolve is idempotent — a double-invoke with the same audit_id yields ONE activity_log row and ONE advance', async () => {
    await withRow({ step: 0 }, async ({ campaign, contact, event, q }) => {
      const J = randomUUID();
      const audit = randomUUID();
      await rpc(q, 'record_step_plan', [campaign, contact, 0, null, null, PR, SLOT_A]);
      await rpc(q, 'reserve_outreach_step', [campaign, contact, 0, PR, SLOT_A, J]);
      // first resolve → resolved (cursor 0→1, audit row inserted).
      expect(
        await rpc(q, 'resolve_outreach_step', [campaign, contact, 0, PR, J, true, null, 'sent', event, audit]),
      ).toBe('resolved');
      // a retry / recovery re-invokes with the SAME (step 0, audit) → the cursor
      // already moved (guard current_step_index=0 fails) → stale, no 2nd advance.
      expect(
        await rpc(q, 'resolve_outreach_step', [campaign, contact, 0, PR, J, true, null, 'sent', event, audit]),
      ).toBe('stale');
      const a = await anchor(q, campaign, contact);
      expect(a.current_step_index).toBe(1); // exactly one advance
      // Exactly one audit row: the retry's cursor-guard short-circuits (stale)
      // AND, had it matched, the activity_log PK + ON CONFLICT DO NOTHING would
      // still dedupe — the audit id makes a double-invoke idempotent either way.
      const cnt = await q('select count(*)::int n from public.activity_log where id=$1', [audit]);
      expect(cnt.rows[0].n).toBe(1);
    });
  });

  it('F.9(2): two concurrent record_step_plan (same planRev, different targetSlot) — only the current expected_planned_at wins the CAS', async () => {
    await withRow({ step: 0 }, async ({ campaign, contact, q }) => {
      // establish the anchor at SLOT_A.
      await rpc(q, 'record_step_plan', [campaign, contact, 0, null, null, PR, SLOT_A]);
      // writer A (holds the current SLOT_A) moves it to SLOT_B → recorded.
      expect(await rpc(q, 'record_step_plan', [campaign, contact, 0, PR, SLOT_A, PR, SLOT_B])).toBe('recorded');
      // writer B (still thinks the anchor is SLOT_A) tries SLOT_C → stale (loses).
      expect(await rpc(q, 'record_step_plan', [campaign, contact, 0, PR, SLOT_A, PR, SLOT_C])).toBe('stale');
      const a = await anchor(q, campaign, contact);
      expect(new Date(a.planned_at as string).toISOString()).toBe(SLOT_B); // A's slot stands
    });
  });
});

// §11.11 — verify the SECURITY-INVOKER + service_role EXECUTE grant end-to-end
// over PostgREST. Targeting a non-existent (campaign, contact) returns 'missing'
// with NO write, so this is safe and needs no cleanup.
describe.skipIf(!RUN)('record_step_plan — service_role PostgREST rpc INVOKER probe (test DB)', () => {
  it('a service_role PostgREST rpc on a non-existent row returns "missing" (grant + INVOKER verified)', async () => {
    const admin = createClient(TEST!.supabaseUrl, TEST!.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc('record_step_plan', {
      p_campaign: randomUUID(),
      p_contact: randomUUID(),
      p_expected_step: 0,
      // nullable CAS params (IS NOT DISTINCT FROM) — codegen types them non-null.
      p_expected_plan_rev: null as unknown as string,
      p_expected_planned_at: null as unknown as string,
      p_next_plan_rev: 'probe',
      p_next_planned_at: new Date().toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe('missing');
  });
});
