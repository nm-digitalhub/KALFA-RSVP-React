import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newPool, requireLocalIntegrationEnv } from '@/lib/testing/local-integration';

// Same gate as the other *.local-it files: under the unit config (no OUTREACH_DB_IT) every case skips.
const RUN = process.env.OUTREACH_DB_IT === '1';

// Console views — read-access matrix, CURRENT behaviour (security audit 21.10.2026, finding M1).
//
// The seven console_* views run with their owner's rights (no security_invoker, by design:
// 20260720193844) and filter on is_console_agent() = is_staff() AND an active console_agents
// row. These tests RECORD what each kind of caller sees today, including the exposure the
// audit classified as M1 (an active agent without view_customer_data still reads guest names,
// RSVP notes and call analysis). They are not a statement of the intended model.
//
// Isolation: ONE connection, ONE transaction, ROLLBACK at the end. Nothing is committed — no
// GoTrue users, no FixtureScope, no cleanup step. Fixture rows (auth.users, platform_staff,
// console_agents, console_agent_secrets, contacts, guests, outreach_state, rsvp_responses,
// call_attempts, call_analysis) exist only inside that transaction. Every trigger on these
// tables was checked to be database-only (no http/dblink); pg_notify is delivered only on commit.
// Callers are impersonated the way PostgREST does it: SET LOCAL ROLE + request.jwt.claims.
// Nothing printed contains row contents beyond synthetic markers.

const MARK = `it-console-${randomUUID().slice(0, 8)}`;
const PHONE = '+972500009911';

type Persona = 'anon' | 'regular' | 'staffNotAgent' | 'agentNoVcd' | 'agentInactive' | 'agentVcd';
const ids: Record<Exclude<Persona, 'anon'>, string> = {
  regular: randomUUID(),
  staffNotAgent: randomUUID(),
  agentNoVcd: randomUUID(),
  agentInactive: randomUUID(),
  agentVcd: randomUUID(),
};

let pool: Pool;
let c: PoolClient;
let eventId: string;
let eventsVisibleToAgents = 0;

async function as<T>(who: Persona, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  await c.query('savepoint p');
  try {
    if (who === 'anon') {
      await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await c.query('set local role anon');
    } else {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[who], role: 'authenticated' })]);
      await c.query('set local role authenticated');
    }
    const value = await fn();
    await c.query('rollback to savepoint p');
    return { ok: true, value };
  } catch (e) {
    await c.query('rollback to savepoint p');
    return { ok: false, code: (e as { code?: string }).code ?? 'unknown' };
  }
}

const rows = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as Record<string, unknown>[];

beforeAll(async () => {
  if (!RUN) return;
  const env = requireLocalIntegrationEnv();
  pool = newPool(env, 'console-views', 1);
  c = await pool.connect();
  await c.query('begin');
  await c.query(`select set_config('lock_timeout', '5s', true)`);

  const ev = await rows(
    `select e.id from public.events e join public.campaigns cp on cp.event_id = e.id order by e.created_at desc limit 1`,
  );
  if (ev.length === 0) throw new Error('local database has no event with a campaign to attach fixtures to');
  eventId = ev[0].id as string;
  const campaignId = (await rows(`select id from public.campaigns where event_id = $1 limit 1`, [eventId]))[0].id;
  eventsVisibleToAgents = Number(
    (await rows(`select count(*) n from public.events e where e.with_ai_calls or exists (select 1 from public.campaigns c where c.event_id = e.id)`))[0].n,
  );

  for (const [k, id] of Object.entries(ids)) {
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())`,
      [id, `${MARK}-${k.toLowerCase()}@kalfa.test`],
    );
  }
  const staff = { staffNotAgent: 'billing_clerk', agentNoVcd: 'auditor', agentInactive: 'billing_clerk', agentVcd: 'billing_clerk' } as const;
  for (const [k, role] of Object.entries(staff)) {
    await c.query(
      `insert into public.platform_staff (user_id, role_id, granted_by) select $1, id, $1 from public.platform_roles where name = $2`,
      [ids[k as keyof typeof staff], role],
    );
  }
  for (const [k, active] of [['agentNoVcd', true], ['agentInactive', false], ['agentVcd', true]] as const) {
    await c.query(`insert into public.console_agents (user_id, display_name, vox_active) values ($1, $2, $3)`, [ids[k], `${MARK}-${k}`, active]);
    await c.query(`insert into public.console_agent_secrets (user_id, vox_password) values ($1, $2)`, [ids[k], `${MARK}-secret-${k}`]);
  }

  const contactId = (await rows(`insert into public.contacts (event_id, normalized_phone) values ($1, $2) returning id`, [eventId, PHONE]))[0].id;
  const guestId = (
    await rows(`insert into public.guests (event_id, full_name, phone, contact_id) values ($1, $2, '0500009911', $3) returning id`, [eventId, `${MARK}-guest`, contactId])
  )[0].id;
  await c.query(`insert into public.outreach_state (event_id, campaign_id, contact_id) values ($1, $2, $3)`, [eventId, campaignId, contactId]);
  await c.query(`insert into public.rsvp_responses (guest_id, event_id, attending, adults, kids, note) values ($1, $2, true, 2, 1, $3)`, [guestId, eventId, `${MARK}-note`]);
  const attemptId = (
    await rows(
      `insert into public.call_attempts (event_id, campaign_id, contact_id, guest_id, touchpoint_index, access_token, token_expires_at)
       values ($1, $2, $3, $4, 0, $5, now() + interval '1 day') returning id`,
      [eventId, campaignId, contactId, guestId, `${MARK}-token`],
    )
  )[0].id;
  await c.query(
    `insert into public.call_analysis (conversation_id, call_attempt_id, attempt_table, attempt_id, linked_at, event_id, el_data)
     values ($1, $2, 'call_attempts', $2, now(), $3, '{"status":"attending","adults":"2","children":"1"}')`,
    [`${MARK}-conv`, attemptId, eventId],
  );
});

afterAll(async () => {
  if (!RUN) return;
  try {
    await c?.query('rollback');
  } finally {
    c?.release();
    await pool?.end();
  }
});

// Per-view probe: the fixture row(s) a caller sees and whether the sensitive columns are filled.
const PROBES = {
  console_events: { sql: `select count(*)::int n, count(*) filter (where event_id = $1)::int fixture from public.console_events`, args: () => [eventId] },
  console_campaigns: { sql: `select count(*)::int n, count(*) filter (where event_id = $1)::int fixture from public.console_campaigns`, args: () => [eventId] },
  console_campaign_targets: {
    sql: `select count(*)::int n, count(*) filter (where guest_name = $2)::int named, count(*) filter (where phone = $3)::int phone from public.console_campaign_targets where event_id = $1`,
    args: () => [eventId, `${MARK}-guest`, PHONE],
  },
  console_event_guests: {
    sql: `select count(*)::int n, count(*) filter (where guest_name = $2)::int named, count(*) filter (where phone = $3)::int phone from public.console_event_guests where event_id = $1`,
    args: () => [eventId, `${MARK}-guest`, PHONE],
  },
  console_rsvp_results: {
    sql: `select count(*)::int n, count(*) filter (where guest_name = $2)::int named, count(*) filter (where note = $3)::int note from public.console_rsvp_results where event_id = $1`,
    args: () => [eventId, `${MARK}-guest`, `${MARK}-note`],
  },
  console_call_analysis: {
    sql: `select count(*)::int n, count(*) filter (where rsvp_status = 'attending' and adults = 2)::int analysed from public.console_call_analysis where event_id = $1`,
    args: () => [eventId],
  },
  console_me: { sql: `select count(*)::int n, count(*) filter (where display_name like $1)::int mine from public.console_me`, args: () => [`${MARK}-%`] },
} as const;
type View = keyof typeof PROBES;

async function probe(who: Persona, view: View) {
  const p = PROBES[view];
  return as(who, async () => (await rows(p.sql, p.args() as unknown[]))[0]);
}

describe.skipIf(!RUN)(`console views — current read behaviour (local, rolled back) [${MARK}]`, () => {
  it('fixtures are in place inside the transaction (control, as the table owner)', async () => {
    expect(eventsVisibleToAgents).toBeGreaterThan(0);
    const n = await rows(`select count(*)::int n from public.console_agents where display_name like $1`, [`${MARK}-%`]);
    expect(n[0].n).toBe(3);
  });

  it.each(Object.keys(PROBES) as View[])('anon: %s is refused by GRANT (42501)', async (view) => {
    expect(await probe('anon', view)).toEqual({ ok: false, code: '42501' });
  });

  it.each(Object.keys(PROBES).filter((v) => v !== 'console_me') as View[])(
    'regular user, staff without an agent row, and an INACTIVE agent see zero rows in %s',
    async (view) => {
      for (const who of ['regular', 'staffNotAgent', 'agentInactive'] as const) {
        const r = await probe(who, view);
        expect(r.ok, `${who} ${view}`).toBe(true);
        if (r.ok) expect(r.value.n, `${who} ${view}`).toBe(0);
      }
    },
  );

  it('console_me: non-agents get no row; every agent row (active or not) returns only the caller', async () => {
    for (const who of ['regular', 'staffNotAgent'] as const) {
      const r = await probe(who, 'console_me');
      expect(r).toEqual({ ok: true, value: { n: 0, mine: 0 } });
    }
    for (const who of ['agentNoVcd', 'agentInactive', 'agentVcd'] as const) {
      const r = await probe(who, 'console_me');
      expect(r, who).toEqual({ ok: true, value: { n: 1, mine: 1 } });
    }
  });

  it('active agents see every event with AI calls or a campaign — not scoped to anything they were assigned', async () => {
    for (const who of ['agentNoVcd', 'agentVcd'] as const) {
      const r = await probe(who, 'console_events');
      expect(r, who).toEqual({ ok: true, value: { n: eventsVisibleToAgents, fixture: 1 } });
    }
  });

  it('M1 (recorded): an active agent WITHOUT view_customer_data reads guest names, RSVP notes and call analysis; only the phone is masked', async () => {
    expect(await probe('agentNoVcd', 'console_campaign_targets')).toEqual({ ok: true, value: { n: 1, named: 1, phone: 0 } });
    expect(await probe('agentNoVcd', 'console_event_guests')).toEqual({ ok: true, value: { n: 1, named: 1, phone: 0 } });
    expect(await probe('agentNoVcd', 'console_rsvp_results')).toEqual({ ok: true, value: { n: 1, named: 1, note: 1 } });
    expect(await probe('agentNoVcd', 'console_call_analysis')).toEqual({ ok: true, value: { n: 1, analysed: 1 } });
    expect(await probe('agentNoVcd', 'console_campaigns')).toMatchObject({ ok: true, value: { fixture: 1 } });
  });

  it('an active agent WITH view_customer_data additionally gets the phone', async () => {
    expect(await probe('agentVcd', 'console_campaign_targets')).toEqual({ ok: true, value: { n: 1, named: 1, phone: 1 } });
    expect(await probe('agentVcd', 'console_event_guests')).toEqual({ ok: true, value: { n: 1, named: 1, phone: 1 } });
  });

  it('console_agent_secrets: vox_password is refused to every client (no column grant), anon has nothing at all', async () => {
    for (const who of ['anon', 'regular', 'staffNotAgent', 'agentNoVcd', 'agentInactive', 'agentVcd'] as const) {
      const r = await as(who, async () => (await rows(`select vox_password from public.console_agent_secrets`)).length);
      expect(r, who).toEqual({ ok: false, code: '42501' });
    }
    expect(await as('anon', async () => (await rows(`select user_id from public.console_agent_secrets`)).length)).toEqual({
      ok: false,
      code: '42501',
    });
  });

  it('console_agent_secrets: authenticated holds a COLUMN grant on user_id; under is_console_agent() an active agent lists EVERY agent that has a secret, not only its own', async () => {
    const seen = async (who: Persona) =>
      as(who, async () => (await rows(`select count(*)::int n from public.console_agent_secrets where user_id = any($1::uuid[])`, [Object.values(ids)]))[0].n);
    expect(await seen('regular')).toEqual({ ok: true, value: 0 });
    expect(await seen('staffNotAgent')).toEqual({ ok: true, value: 0 });
    expect(await seen('agentInactive')).toEqual({ ok: true, value: 0 });
    expect(await seen('agentNoVcd')).toEqual({ ok: true, value: 3 });
    expect(await seen('agentVcd')).toEqual({ ok: true, value: 3 });
  });

  it('console_agent_secrets: grants and policy as audited (column SELECT on user_id only; policy is_console_agent(), not ownership)', async () => {
    const pol = await rows(
      `select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'console_agent_secrets'`,
    );
    expect(pol).toEqual([{ policyname: 'console_agent_secrets_select', cmd: 'SELECT', qual: 'is_console_agent()' }]);
    const tableGrants = await rows(
      `select grantee from information_schema.role_table_grants where table_schema = 'public' and table_name = 'console_agent_secrets' and grantee in ('anon', 'authenticated')`,
    );
    expect(tableGrants).toEqual([]);
    const columnGrants = await rows(
      `select grantee, column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'console_agent_secrets' and grantee in ('anon', 'authenticated') order by 1, 2`,
    );
    expect(columnGrants).toEqual([{ grantee: 'authenticated', column_name: 'user_id', privilege_type: 'SELECT' }]);
  });
});
