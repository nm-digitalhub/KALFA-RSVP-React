import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newPool, requireLocalIntegrationEnv } from '@/lib/testing/local-integration';

// Same gate as the other *.local-it files: under the unit config (no OUTREACH_DB_IT) every case skips.
const RUN = process.env.OUTREACH_DB_IT === '1';

// Console access — the target model of openspec/changes/harden-console-agent-permissions.
//
// The seven owner-rights console views (no security_invoker, by design: 20260720193844) filter on
// is_console_agent() = is_staff() AND an active console_agents row. Work data (guest names, RSVP,
// notes, call analysis) stays visible to active agents by design (D2); only the phone needs
// view_customer_data. S1 closes console_agent_secrets to every client (D4: the roster's
// `provisioned` comes from a definer helper) and narrows console_agent_shift (D5).
//
// Staff fixtures use roles created inside the transaction with an explicit permission set
// (no seeded role contents): `<MARK>-novcd` holds nothing, `<MARK>-vcd` holds view_customer_data.
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
let eventOut: string;
let attemptA: string;
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
  const roles = { novcd: `${MARK}-novcd`, vcd: `${MARK}-vcd` } as const;
  for (const name of Object.values(roles)) {
    await c.query(`insert into public.platform_roles (name, label) values ($1, $1)`, [name]);
  }
  await c.query(
    `insert into public.platform_role_permissions (role_id, permission_id)
     select r.id, d.id from public.platform_roles r, public.platform_permission_definitions d
      where r.name = $1 and d.key = 'view_customer_data'`,
    [roles.vcd],
  );
  const staff = { staffNotAgent: roles.novcd, agentNoVcd: roles.novcd, agentInactive: roles.vcd, agentVcd: roles.vcd } as const;
  for (const [k, role] of Object.entries(staff)) {
    await c.query(
      `insert into public.platform_staff (user_id, role_id, granted_by) select $1, id, $1 from public.platform_roles where name = $2`,
      [ids[k as keyof typeof staff], role],
    );
  }
  for (const [k, active] of [['agentNoVcd', true], ['agentInactive', false], ['agentVcd', true]] as const) {
    await c.query(`insert into public.console_agents (user_id, display_name, vox_active, vox_username) values ($1, $2, $3, $4)`, [
      ids[k],
      `${MARK}-${k}`,
      active,
      `${MARK}-${k.toLowerCase()}`,
    ]);
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

  // S2 (D3a) fixtures: an event OUTSIDE console scope (no campaign, with_ai_calls false) with a guest and an RSVP.
  // Campaign targets and attempt-linked analyses cannot belong to such an event by construction
  // (outreach_state.campaign_id and call_attempts.campaign_id are NOT NULL), so two analysis edge rows stand in:
  // one whose own event_id points at the out-of-scope event, one with no event_id at all.
  eventOut = (await rows(`insert into public.events (owner_id, name, with_ai_calls) values ($1, $2, false) returning id`, [ids.regular, `${MARK}-out`]))[0]
    .id as string;
  const contactOut = (await rows(`insert into public.contacts (event_id, normalized_phone) values ($1, '+972500009912') returning id`, [eventOut]))[0].id;
  const guestOut = (
    await rows(`insert into public.guests (event_id, full_name, phone, contact_id) values ($1, $2, '0500009912', $3) returning id`, [eventOut, `${MARK}-guest-out`, contactOut])
  )[0].id;
  await c.query(`insert into public.rsvp_responses (guest_id, event_id, attending, adults, kids, note) values ($1, $2, false, 0, 0, $3)`, [guestOut, eventOut, `${MARK}-note-out`]);
  for (const [conv, ev] of [[`${MARK}-conv-out`, eventOut], [`${MARK}-conv-noevent`, null]] as const) {
    await c.query(
      `insert into public.call_analysis (conversation_id, call_attempt_id, attempt_table, attempt_id, linked_at, event_id, el_data)
       values ($1, $2, 'call_attempts', $2, now(), $3, '{"status":"attending"}')`,
      [conv, attemptId, ev],
    );
  }

  // Workflow fixtures (task 3.3): the agent's own live call, its dispatch status, its monitor leg, a chat message, and the
  // trigger-created feed row made claimable (non-terminal, unclaimed).
  attemptA = attemptId as string;
  await c.query(
    `insert into public.console_calls (direction, kind, status, agent_id, event_id, guest_id, contact_id, call_attempt_id, caller_masked)
     values ('outbound', 'manual', 'connected', $1, $2, $3, $4, $5, $6)`,
    [ids.agentVcd, eventId, guestId, contactId, attemptId, `${MARK}-masked`],
  );
  await c.query(`insert into public.call_dispatch_status (dispatch_id, event_id, contact_id, call_attempt_id) values (gen_random_uuid(), $1, $2, $3)`, [
    eventId,
    contactId,
    attemptId,
  ]);
  await c.query(
    `insert into public.human_agent_call_legs (call_attempt_id, request_id, mode, status, agent_id) values ($1, gen_random_uuid(), 'monitor', 'requested', $2)`,
    [attemptId, ids.agentVcd],
  );
  await c.query(`insert into public.console_chat_messages (author_id, body) values ($1, $2)`, [ids.agentNoVcd, `${MARK}-chat`]);
  const feed = await c.query(`update public.console_call_feed set status = 'in-progress', agent_id = null where call_attempt_id = $1`, [attemptId]);
  if (feed.rowCount !== 1) throw new Error('expected the trigger-created console_call_feed row');
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

describe.skipIf(!RUN)(`console access — target model (local, rolled back) [${MARK}]`, () => {
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

  it('D2 work data: an active agent WITHOUT view_customer_data reads guest names, RSVP notes and call analysis; only the phone is masked', async () => {
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

  it('S2/D3a scope: no active agent reads guests, RSVP or call analysis of an event outside console scope', async () => {
    for (const who of ['agentNoVcd', 'agentVcd'] as const) {
      const r = await as(who, async () => ({
        console_events: (await rows(`select count(*)::int n from public.console_events where event_id = $1`, [eventOut]))[0].n,
        console_event_guests: (await rows(`select count(*)::int n from public.console_event_guests where event_id = $1`, [eventOut]))[0].n,
        console_rsvp_results: (await rows(`select count(*)::int n from public.console_rsvp_results where event_id = $1`, [eventOut]))[0].n,
        console_campaign_targets: (await rows(`select count(*)::int n from public.console_campaign_targets where event_id = $1`, [eventOut]))[0].n,
        console_call_analysis: (await rows(`select count(*)::int n from public.console_call_analysis where event_id = $1`, [eventOut]))[0].n,
      }));
      expect(r, who).toEqual({
        ok: true,
        value: { console_events: 0, console_event_guests: 0, console_rsvp_results: 0, console_campaign_targets: 0, console_call_analysis: 0 },
      });
    }
  });

  it('S2/D3a scope: an attempt-linked analysis without an event_id stays visible (it belongs to an in-scope attempt)', async () => {
    const r = await as('agentNoVcd', async () => (await rows(`select count(*)::int n from public.console_call_analysis where event_id is null`))[0].n);
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it('S1/D4 console_agent_secrets: every client is refused, user_id included (no direct reader remains)', async () => {
    for (const who of ['anon', 'regular', 'staffNotAgent', 'agentNoVcd', 'agentInactive', 'agentVcd'] as const) {
      for (const col of ['user_id', 'vox_password']) {
        const r = await as(who, async () => (await rows(`select ${col} from public.console_agent_secrets`)).length);
        expect(r, `${who} ${col}`).toEqual({ ok: false, code: '42501' });
      }
    }
  });

  it('S1/D4 console_agent_secrets: no policy and no table or column privilege for anon/authenticated', async () => {
    expect(await rows(`select policyname from pg_policies where schemaname = 'public' and tablename = 'console_agent_secrets'`)).toEqual([]);
    const priv = await rows(
      `select r.role, a.attname, p.priv
         from unnest(array['anon', 'authenticated']) r(role)
         cross join (select attname from pg_attribute where attrelid = 'public.console_agent_secrets'::regclass and attnum > 0 and not attisdropped) a
         cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(priv)
        where has_column_privilege(r.role, 'public.console_agent_secrets', a.attname, p.priv)`,
    );
    expect(priv).toEqual([]);
  });

  it('S1/D4 roster: provisioned = (vox_username set AND a stored secret) for every agent, unchanged for colleagues', async () => {
    const expected = Object.fromEntries(
      (
        await rows(
          `select ca.user_id::text, (ca.vox_username is not null and exists (select 1 from public.console_agent_secrets s where s.user_id = ca.user_id)) p
             from public.console_agents ca where ca.user_id = any($1::uuid[])`,
          [Object.values(ids)],
        )
      ).map((x) => [x.user_id, x.p]),
    );
    for (const who of ['agentNoVcd', 'agentVcd'] as const) {
      const r = await as(who, async () =>
        Object.fromEntries(
          (await rows(`select user_id::text, provisioned from public.console_agents_roster where user_id = any($1::uuid[])`, [Object.values(ids)])).map((x) => [
            x.user_id,
            x.provisioned,
          ]),
        ),
      );
      expect(r, who).toEqual({ ok: true, value: expected });
    }
    // Without a secret the flag is false (semantics preserved).
    await c.query('savepoint nosecret');
    await c.query(`delete from public.console_agent_secrets where user_id = $1`, [ids.agentInactive]);
    const r = await as('agentVcd', async () => (await rows(`select provisioned from public.console_agents_roster where user_id = $1`, [ids.agentInactive]))[0]);
    await c.query('rollback to savepoint nosecret');
    expect(r).toEqual({ ok: true, value: { provisioned: false } });
    // Non-agents see no roster at all.
    expect(await as('regular', async () => (await rows(`select count(*)::int n from public.console_agents_roster`))[0].n)).toEqual({ ok: true, value: 0 });
  });

  // The statement PostgREST sends for supabase-js .upsert({...}, { onConflict: 'agent_id' }) (api/agents/shift/route.ts:76-81).
  const SHIFT_UPSERT = `with s as (insert into public.console_agent_shift (agent_id, active, updated_at) values ($1, $2, now())
      on conflict (agent_id) do update set agent_id = excluded.agent_id, active = excluded.active, updated_at = excluded.updated_at
      returning 1) select count(*)::int n from s`;

  it('S1/D5 shift: the PostgREST upsert works for an active agent on the insert AND the conflict path', async () => {
    const ins = await as('agentVcd', async () => (await rows(SHIFT_UPSERT, [ids.agentVcd, true]))[0].n);
    await c.query('savepoint shiftrow');
    await c.query(`insert into public.console_agent_shift (agent_id, active) values ($1, false)`, [ids.agentVcd]);
    const upd = await as('agentVcd', async () => (await rows(SHIFT_UPSERT, [ids.agentVcd, true]))[0].n);
    const own = await as('agentVcd', async () => (await rows(`select count(*)::int n from public.console_agent_shift where agent_id = $1`, [ids.agentVcd]))[0].n);
    await c.query('rollback to savepoint shiftrow');
    expect({ ins, upd, own }).toEqual({ ins: { ok: true, value: 1 }, upd: { ok: true, value: 1 }, own: { ok: true, value: 1 } });
  });

  it('S1/D5 shift: an INACTIVE agent changes nothing — upsert refused, UPDATE with or without WHERE hits 0 rows', async () => {
    await c.query('savepoint inactiveshift');
    await c.query(`insert into public.console_agent_shift (agent_id, active) values ($1, false)`, [ids.agentInactive]);
    const upsert = await as('agentInactive', async () => (await rows(SHIFT_UPSERT, [ids.agentInactive, true]))[0].n);
    const where = await as('agentInactive', async () => (await c.query(`update public.console_agent_shift set active = true where agent_id = $1`, [ids.agentInactive])).rowCount);
    const noWhere = await as('agentInactive', async () => (await c.query(`update public.console_agent_shift set active = true`)).rowCount);
    await c.query('rollback to savepoint inactiveshift');
    expect({ upsert, where, noWhere }).toEqual({ upsert: { ok: false, code: '42501' }, where: { ok: true, value: 0 }, noWhere: { ok: true, value: 0 } });
  });

  it('S1/D5 shift: authenticated holds SELECT + INSERT/UPDATE on (agent_id, active, updated_at) only; no TRUNCATE/TRIGGER/REFERENCES/MAINTAIN; anon nothing', async () => {
    const table = await rows(
      `select r.role, p.priv from unnest(array['anon', 'authenticated']) r(role)
         cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p(priv)
        where has_table_privilege(r.role, 'public.console_agent_shift', p.priv) order by 1, 2`,
    );
    expect(table).toEqual([{ role: 'authenticated', priv: 'SELECT' }]);
    const cols = await rows(
      `select p.priv, string_agg(a.attname, ',' order by a.attname) cols
         from pg_attribute a cross join unnest(array['INSERT', 'UPDATE']) p(priv)
        where a.attrelid = 'public.console_agent_shift'::regclass and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('authenticated', 'public.console_agent_shift', a.attname, p.priv)
        group by p.priv order by 1`,
    );
    expect(cols).toEqual([
      { priv: 'INSERT', cols: 'active,agent_id,updated_at' },
      { priv: 'UPDATE', cols: 'active,agent_id,updated_at' },
    ]);
  });
});

// Task 3.3: every console workflow in the spec, as the active agents, in the statement shape its client sends (the call
// sites are cited per case). Expected rows are computed as the table owner from the same fixtures, so a policy or grant
// that hides or adds a row fails here.
describe.skipIf(!RUN)(`console workflows — client statement shapes (local, rolled back) [${MARK}]`, () => {
  const AGENT_STATUS_UPSERT = `with s as (insert into public.agent_status (agent_id, status, updated_at) values ($1, $2, now())
      on conflict (agent_id) do update set agent_id = excluded.agent_id, status = excluded.status, updated_at = excluded.updated_at
      returning 1) select count(*)::int n from s`;
  const SHIFT_UPSERT_W = `with s as (insert into public.console_agent_shift (agent_id, active, updated_at) values ($1, $2, now())
      on conflict (agent_id) do update set agent_id = excluded.agent_id, active = excluded.active, updated_at = excluded.updated_at
      returning 1) select count(*)::int n from s`;
  const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];

  it('profile: console_me (admin/layout.tsx:116, voice/console/page.tsx:18) returns the caller with its telephony username', async () => {
    for (const who of ['agentNoVcd', 'agentVcd'] as const) {
      const r = await as(who, async () => rows(`select vox_username, display_name from public.console_me`));
      expect(r, who).toEqual({ ok: true, value: [{ vox_username: `${MARK}-${who.toLowerCase()}`, display_name: `${MARK}-${who}` }] });
    }
  });

  it('in-scope lists: events, campaigns, targets, guests, RSVP and analysis equal the owner-computed sets for the fixture event', async () => {
    const expected = {
      events: eventsVisibleToAgents,
      campaigns: Number((await one(`select count(*)::int n from public.campaigns where event_id = $1`, [eventId])).n),
      targets: Number((await one(`select count(*)::int n from public.outreach_state where event_id = $1`, [eventId])).n),
      guests: Number((await one(`select count(*)::int n from public.guests where event_id = $1`, [eventId])).n),
      rsvp: Number((await one(`select count(*)::int n from public.rsvp_responses where event_id = $1`, [eventId])).n),
      analysis: Number((await one(`select count(*)::int n from public.call_analysis where event_id = $1 and call_attempt_id is not null`, [eventId])).n),
    };
    for (const who of ['agentNoVcd', 'agentVcd'] as const) {
      const r = await as(who, async () => ({
        events: (await one(`select count(*)::int n from public.console_events`)).n,
        campaigns: (await one(`select count(*)::int n from public.console_campaigns where event_id = $1`, [eventId])).n,
        targets: (await one(`select count(*)::int n from public.console_campaign_targets where event_id = $1`, [eventId])).n,
        // softphone-panel.tsx:515 guest card columns
        guests: (await rows(`select guest_id, event_id, guest_name, rsvp_status, phone from public.console_event_guests where event_id = $1`, [eventId])).length,
        rsvp: (await one(`select count(*)::int n from public.console_rsvp_results where event_id = $1`, [eventId])).n,
        analysis: (await one(`select count(*)::int n from public.console_call_analysis where event_id = $1`, [eventId])).n,
      }));
      expect(r, who).toEqual({ ok: true, value: expected });
    }
  });

  it('roster (softphone-panel.tsx:312): every agent with the columns the softphone selects', async () => {
    const r = await as('agentNoVcd', async () =>
      rows(
        `select user_id, display_name, status, status_updated_at, provisioned, calendar_busy_until, calendar_show_as
           from public.console_agents_roster where user_id = any($1::uuid[]) order by display_name`,
        [Object.values(ids)],
      ),
    );
    expect(r.ok && r.value.map((x) => [x.display_name, x.provisioned])).toEqual([
      [`${MARK}-agentInactive`, true],
      [`${MARK}-agentNoVcd`, true],
      [`${MARK}-agentVcd`, true],
    ]);
  });

  it('own live call (softphone-panel.tsx:480): the agent finds its connected call', async () => {
    const sql = `select id, status, event_id, guest_id, contact_id, direction, caller_masked from public.console_calls
                  where status in ('ringing', 'connected') and (agent_id = $1 or transferred_to_agent_id = $1) and caller_masked = $2`;
    expect(await as('agentVcd', async () => (await rows(sql, [ids.agentVcd, `${MARK}-masked`])).length)).toEqual({ ok: true, value: 1 });
  });

  it('dispatch status and own monitor leg (Android §2, ai-handoff-section.tsx:138)', async () => {
    const r = await as('agentVcd', async () => ({
      dispatch: (await one(`select count(*)::int n from public.call_dispatch_status where event_id = $1`, [eventId])).n,
      legs: (await rows(`select call_attempt_id, mode, status, requested_at from public.human_agent_call_legs where status = 'requested' and call_attempt_id = $1`, [attemptA])).length,
    }));
    expect(r).toEqual({ ok: true, value: { dispatch: 1, legs: 1 } });
  });

  it('chat (softphone-panel.tsx:562, chat-section.tsx:77): read the thread, insert an own message', async () => {
    const r = await as('agentVcd', async () => ({
      read: (await rows(`select id, author_id, body, created_at from public.console_chat_messages where body = $1`, [`${MARK}-chat`])).length,
      insert: (await c.query(`insert into public.console_chat_messages (author_id, body) values ($1, $2)`, [ids.agentVcd, `${MARK}-chat-2`])).rowCount,
    }));
    expect(r).toEqual({ ok: true, value: { read: 1, insert: 1 } });
  });

  it('own state: shift upsert (api/agents/shift) and agent_status upsert (api/agents/status) in PostgREST shape, both paths', async () => {
    const r = await as('agentVcd', async () => {
      const shiftInsert = (await one(SHIFT_UPSERT_W, [ids.agentVcd, true])).n;
      const shiftConflict = (await one(SHIFT_UPSERT_W, [ids.agentVcd, false])).n;
      const statusInsert = (await one(AGENT_STATUS_UPSERT, [ids.agentVcd, 'ready'])).n;
      const statusConflict = (await one(AGENT_STATUS_UPSERT, [ids.agentVcd, 'dnd'])).n;
      return { shiftInsert, shiftConflict, statusInsert, statusConflict };
    });
    expect(r).toEqual({ ok: true, value: { shiftInsert: 1, shiftConflict: 1, statusInsert: 1, statusConflict: 1 } });
  });

  it('feed claim (ai-handoff-section.tsx:199): an unclaimed live call is claimed by one agent; a second claim finds nothing', async () => {
    const claim = `update public.console_call_feed
                      set agent_id = $1, handled_by = 'human', takeover_claimed_at = now(), takeover_request_id = gen_random_uuid(), participation_state = 'claimed'
                    where call_attempt_id = $2 and agent_id is null returning call_attempt_id`;
    await c.query('savepoint claim');
    const first = await as('agentVcd', async () => (await rows(claim, [ids.agentVcd, attemptA])).length);
    // as() rolls its own work back; apply the first claim as the owner so the second agent meets a claimed row.
    await c.query(`update public.console_call_feed set agent_id = $1 where call_attempt_id = $2`, [ids.agentVcd, attemptA]);
    const second = await as('agentNoVcd', async () => (await rows(claim, [ids.agentNoVcd, attemptA])).length);
    await c.query('rollback to savepoint claim');
    expect({ first, second }).toEqual({ first: { ok: true, value: 1 }, second: { ok: true, value: 0 } });
  });

  it('Realtime tables keep the SELECT policy and grant their subscriptions rely on', async () => {
    const pol = await rows(
      `select tablename, qual from pg_policies where schemaname = 'public' and cmd = 'SELECT'
          and tablename in ('console_calls', 'console_call_feed', 'console_chat_messages') order by 1`,
    );
    expect(pol).toEqual([
      { tablename: 'console_call_feed', qual: 'is_console_agent()' },
      { tablename: 'console_calls', qual: 'is_console_agent()' },
      { tablename: 'console_chat_messages', qual: 'is_console_agent()' },
    ]);
    const sel = await rows(
      `select t from unnest(array['console_calls', 'console_call_feed', 'console_chat_messages']) t
        where has_table_privilege('authenticated', 'public.' || t, 'SELECT') order by 1`,
    );
    expect(sel.map((x) => x.t)).toEqual(['console_call_feed', 'console_calls', 'console_chat_messages']);
  });
});

// Task 4.1: the client privilege map of design D5, evaluated with has_table_privilege / has_column_privilege (not
// information_schema, which omits MAINTAIN). Every console object is listed from the catalog, so a new console table or
// view without an entry here fails. A mismatch is reported as `<object>[.<column>] <role> <privilege>`.
const TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;
const COLUMN_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const;
type AccessEntry = { table: readonly string[]; columns?: Partial<Record<(typeof COLUMN_PRIVS)[number], readonly string[]>> };
const VIEW: AccessEntry = { table: ['SELECT'] };
const READ: AccessEntry = { table: ['SELECT'] };
const NONE: AccessEntry = { table: [] };
const ACCESS_MAP: Record<string, AccessEntry> = {
  console_events: VIEW,
  console_campaigns: VIEW,
  console_campaign_targets: VIEW,
  console_event_guests: VIEW,
  console_rsvp_results: VIEW,
  console_call_analysis: VIEW,
  console_me: VIEW,
  console_agents_roster: VIEW,
  console_agents: READ,
  console_calls: READ,
  console_queues: READ,
  console_agent_queues: READ,
  console_agent_calendar_presence: READ,
  call_dispatch_status: READ,
  // The app reports its SDK call and device on its own monitor leg (app-integration-reference.md §7).
  human_agent_call_legs: { table: ['SELECT'], columns: { UPDATE: ['device_id', 'vox_sdk_call_id'] } },
  console_agent_shift: { table: ['SELECT'], columns: { INSERT: ['active', 'agent_id', 'updated_at'], UPDATE: ['active', 'agent_id', 'updated_at'] } },
  console_call_feed: {
    table: ['SELECT'],
    columns: { UPDATE: ['agent_id', 'handled_by', 'participation_state', 'takeover_claimed_at', 'takeover_request_id'] },
  },
  // Table-level INSERT (live relacl authenticated=ar); the insert policy requires an active agent writing as itself.
  console_chat_messages: { table: ['SELECT', 'INSERT'] },
  agent_status: { table: ['SELECT', 'INSERT', 'UPDATE'] },
  console_agent_secrets: NONE,
  console_call_pii: NONE,
  console_agent_commands: NONE,
};
const HELPERS = ['public.is_console_agent()', 'public.console_event_in_scope(uuid)', 'public.console_agent_provisioned(uuid)'] as const;

describe.skipIf(!RUN)(`console privilege inventory (D5 access map) [${MARK}]`, () => {
  it('the map lists exactly the console objects in the catalog', async () => {
    const objs = await rows(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')
          and (relname like 'console\_%' or relname in ('agent_status', 'call_dispatch_status', 'human_agent_call_legs')) order by 1`,
    );
    expect(objs.map((o) => o.relname)).toEqual(Object.keys(ACCESS_MAP).sort());
  });

  it('anon, PUBLIC and authenticated hold exactly the mapped table and column privileges', async () => {
    const mismatches: string[] = [];
    for (const [obj, entry] of Object.entries(ACCESS_MAP)) {
      const rel = `public.${obj}`;
      for (const role of ['anon', 'public', 'authenticated'] as const) {
        const table = (
          await rows(`select p from unnest($2::text[]) p where has_table_privilege($1, $3::regclass, p)`, [role, TABLE_PRIVS, rel])
        ).map((x) => x.p as string);
        const want = role === 'authenticated' ? entry.table : [];
        for (const p of TABLE_PRIVS) {
          if (table.includes(p) !== want.includes(p)) mismatches.push(`${obj} ${role} ${p}${table.includes(p) ? ' (unexpected)' : ' (missing)'}`);
        }
        for (const p of COLUMN_PRIVS) {
          if (table.includes(p)) continue; // the table-level privilege already covers every column
          const cols = (
            await rows(
              `select attname from pg_attribute where attrelid = $2::regclass and attnum > 0 and not attisdropped
                  and has_column_privilege($1, $2::regclass, attname, $3) order by 1`,
              [role, rel, p],
            )
          ).map((x) => x.attname as string);
          const wantCols = role === 'authenticated' ? [...(entry.columns?.[p] ?? [])].sort() : [];
          for (const col of new Set([...cols, ...wantCols])) {
            if (cols.includes(col) !== wantCols.includes(col)) mismatches.push(`${obj}.${col} ${role} ${p}${cols.includes(col) ? ' (unexpected)' : ' (missing)'}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('console helpers: EXECUTE for authenticated, not for anon or PUBLIC; search_path is empty', async () => {
    const out: string[] = [];
    for (const fn of HELPERS) {
      const r = (
        await rows(
          `select has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') a,
                  has_function_privilege('anon', $1::regprocedure, 'EXECUTE') n,
                  has_function_privilege('public', $1::regprocedure, 'EXECUTE') p,
                  coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = $1::regprocedure), '') cfg`,
          [fn],
        )
      )[0];
      if (!r.a) out.push(`${fn} authenticated EXECUTE (missing)`);
      if (r.n) out.push(`${fn} anon EXECUTE (unexpected)`);
      if (r.p) out.push(`${fn} PUBLIC EXECUTE (unexpected)`);
      if (r.cfg !== 'search_path=""') out.push(`${fn} search_path is "${String(r.cfg)}", expected empty`);
    }
    expect(out).toEqual([]);
  });
});

// Tasks 4.1/4.2 for human_agent_call_legs (design D5; migration 20261021195752). The app reports device_id and
// vox_sdk_call_id on its own monitor leg (app-integration-reference.md §7); the server writes everything else.
// Grants are unchanged by the migration — only the update policy gains is_console_agent().
describe.skipIf(!RUN)(`human_agent_call_legs device columns (local, rolled back) [${MARK}]`, () => {
  const LEG_COLS = ['device_id', 'vox_sdk_call_id'];
  // The statement PostgREST sends for .update({...}).eq('call_attempt_id', x).select(): WHERE + RETURNING.
  const REST_SHAPE = `update public.human_agent_call_legs set device_id = $2, vox_sdk_call_id = $3 where call_attempt_id = $1 returning agent_id`;
  const legOf = async (agent: string) =>
    (await rows(`select device_id, vox_sdk_call_id from public.human_agent_call_legs where call_attempt_id = $1 and agent_id = $2`, [attemptA, agent]))[0];

  // Run `fn` as `who`, then read the legs back AS THE OWNER before rolling back, so "no other row changed" is checked
  // on the real table, not through the caller's RLS view of it.
  async function asThenOwner<T>(who: Exclude<Persona, 'anon'>, fn: () => Promise<T>) {
    await c.query('savepoint k');
    try {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[who], role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const value = await fn();
      await c.query('reset role');
      const after = {
        agentVcd: await legOf(ids.agentVcd),
        agentNoVcd: await legOf(ids.agentNoVcd),
        agentInactive: await legOf(ids.agentInactive),
      };
      return { ok: true as const, value, after };
    } catch (e) {
      return { ok: false as const, code: (e as { code?: string }).code ?? 'unknown' };
    } finally {
      await c.query('rollback to savepoint k');
    }
  }
  const untouched = { device_id: null, vox_sdk_call_id: null };

  beforeAll(async () => {
    if (!RUN) return;
    await c.query('savepoint legs_fixture');
    // agentVcd's leg comes from the file fixture; add one for each other persona.
    for (const agent of [ids.agentNoVcd, ids.agentInactive]) {
      await c.query(
        `insert into public.human_agent_call_legs (call_attempt_id, request_id, mode, status, agent_id) values ($1, gen_random_uuid(), 'monitor', 'requested', $2)`,
        [attemptA, agent],
      );
    }
  });
  afterAll(async () => {
    if (!RUN) return;
    await c.query('rollback to savepoint legs_fixture');
  });

  it('4.1 column privileges: authenticated may UPDATE device_id and vox_sdk_call_id only; no INSERT/DELETE; anon nothing', async () => {
    const cols = async (role: string, priv: string) =>
      (
        await rows(
          `select attname from pg_attribute where attrelid = 'public.human_agent_call_legs'::regclass and attnum > 0 and not attisdropped
              and has_column_privilege($1, 'public.human_agent_call_legs'::regclass, attname, $2) order by 1`,
          [role, priv],
        )
      ).map((x) => x.attname);
    const table = async (role: string, priv: string) =>
      (await rows(`select has_table_privilege($1, 'public.human_agent_call_legs', $2) v`, [role, priv]))[0].v;
    expect({
      update: await cols('authenticated', 'UPDATE'),
      insert: await cols('authenticated', 'INSERT'),
      tableUpdate: await table('authenticated', 'UPDATE'),
      tableDelete: await table('authenticated', 'DELETE'),
      tableSelect: await table('authenticated', 'SELECT'),
      anonUpdate: await cols('anon', 'UPDATE'),
      anonSelect: await table('anon', 'SELECT'),
    }).toEqual({ update: LEG_COLS, insert: [], tableUpdate: false, tableDelete: false, tableSelect: true, anonUpdate: [], anonSelect: false });
  });

  it('4.2 active agent, Data API shape (WHERE + RETURNING): its own leg changes, the colleagues\u2019 legs do not', async () => {
    const r = await asThenOwner('agentVcd', async () => (await rows(REST_SHAPE, [attemptA, `${MARK}-dev`, `${MARK}-sdk`])).map((x) => x.agent_id));
    expect(r).toEqual({
      ok: true,
      value: [ids.agentVcd],
      after: { agentVcd: { device_id: `${MARK}-dev`, vox_sdk_call_id: `${MARK}-sdk` }, agentNoVcd: untouched, agentInactive: untouched },
    });
  });

  it('4.2 active agent, UPDATE without WHERE: only its own leg changes', async () => {
    const r = await asThenOwner('agentVcd', async () => (await c.query(`update public.human_agent_call_legs set device_id = $1`, [`${MARK}-dev`])).rowCount);
    expect(r).toEqual({
      ok: true,
      value: 1,
      after: { agentVcd: { device_id: `${MARK}-dev`, vox_sdk_call_id: null }, agentNoVcd: untouched, agentInactive: untouched },
    });
  });

  it('4.1 any other column is refused with 42501, even on the own leg', async () => {
    const out: Record<string, unknown> = {};
    for (const set of [`status = 'connected'`, `agent_id = '${ids.agentNoVcd}'`, `mode = 'barge'`, `call_attempt_id = call_attempt_id`]) {
      const r = await asThenOwner('agentVcd', async () => (await c.query(`update public.human_agent_call_legs set ${set} where agent_id = $1`, [ids.agentVcd])).rowCount);
      out[set.split(' ')[0]] = r.ok ? 'ALLOWED' : r.code;
    }
    expect(out).toEqual({ status: '42501', agent_id: '42501', mode: '42501', call_attempt_id: '42501' });
  });

  it('4.2 inactive agent: 0 rows with WHERE, without WHERE and in the Data API shape; nothing changes', async () => {
    const forms = {
      where: (await asThenOwner('agentInactive', async () => (await c.query(`update public.human_agent_call_legs set device_id = 'x' where agent_id = $1`, [ids.agentInactive])).rowCount)),
      noWhere: await asThenOwner('agentInactive', async () => (await c.query(`update public.human_agent_call_legs set device_id = 'x', vox_sdk_call_id = 'y'`)).rowCount),
      restShape: await asThenOwner('agentInactive', async () => (await rows(REST_SHAPE, [attemptA, 'x', 'y'])).length),
    };
    const nothing = { agentVcd: untouched, agentNoVcd: untouched, agentInactive: untouched };
    expect(forms).toEqual({
      where: { ok: true, value: 0, after: nothing },
      noWhere: { ok: true, value: 0, after: nothing },
      restShape: { ok: true, value: 0, after: nothing },
    });
  });

  it('4.2 red check: with the pre-migration policy (rollback header of 20261021195752) the inactive agent DOES change its leg', async () => {
    await c.query('savepoint old_policy');
    try {
      await c.query(`alter policy human_agent_call_legs_update_own on public.human_agent_call_legs
                       using (agent_id = (select auth.uid())) with check (agent_id = (select auth.uid()))`);
      const r = await asThenOwner('agentInactive', async () => (await c.query(`update public.human_agent_call_legs set device_id = 'x'`)).rowCount);
      expect(r).toEqual({ ok: true, value: 1, after: { agentVcd: untouched, agentNoVcd: untouched, agentInactive: { device_id: 'x', vox_sdk_call_id: null } } });
    } finally {
      await c.query('rollback to savepoint old_policy');
    }
    // And the live policy is back: the gate is present.
    const pol = (await rows(`select qual, with_check from pg_policies where tablename = 'human_agent_call_legs' and policyname = 'human_agent_call_legs_update_own'`))[0];
    expect([pol.qual, pol.with_check].every((q) => String(q).includes('is_console_agent()'))).toBe(true);
  });
});
