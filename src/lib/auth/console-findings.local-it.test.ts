import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newPool, requireLocalIntegrationEnv } from '@/lib/testing/local-integration';

// Same gate as the other *.local-it files: under the unit config (no OUTREACH_DB_IT) every case skips.
const RUN = process.env.OUTREACH_DB_IT === '1';

// VERIFICATION PROBE for the 21.10.2026 review of openspec/changes/harden-console-agent-permissions.
// Each case executes one finding's behavioural claim as the role a client session runs as
// (SET LOCAL ROLE + request.jwt.claims, the PostgREST mechanism). A failing case = the finding is
// REFUTED. Isolation: one connection, one transaction, ROLLBACK at the end; the "simulated" cases
// apply a proposed policy/grant change inside a SAVEPOINT and roll it back before the next case.
// Nothing is committed. Observations are recorded per case (no row contents
// beyond synthetic markers). Set CONSOLE_FINDINGS_OBS_PATH to also write the observations as JSON.

const OBS_PATH = process.env.CONSOLE_FINDINGS_OBS_PATH; // optional: where to write the observations JSON
const MARK = `it-cfind-${randomUUID().slice(0, 8)}`;
const PHONE = '+972500009922';

type Persona = 'anon' | 'regular' | 'staffNotAgent' | 'agentNoVcd' | 'agentInactive' | 'agentVcd';
const ids = {
  regular: randomUUID(),
  staffNotAgent: randomUUID(),
  agentNoVcd: randomUUID(),
  agentInactive: randomUUID(),
  agentVcd: randomUUID(),
};
const AGENTS = ['agentNoVcd', 'agentInactive', 'agentVcd'] as const;

let pool: Pool;
let c: PoolClient;
let eventA: string; // has a campaign (inside console_events scope)
let eventB: string; // no campaign, with_ai_calls = false (outside console_events scope)
const notices: string[] = [];
const obs: Record<string, unknown> = {};

type R = { ok: true; rows: Record<string, unknown>[]; count: number | null } | { ok: false; code: string };

async function as(who: Persona, sql: string, params: unknown[] = []): Promise<R> {
  await c.query('savepoint p');
  try {
    if (who === 'anon') {
      await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await c.query('set local role anon');
    } else {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[who], role: 'authenticated' })]);
      await c.query('set local role authenticated');
    }
    const r = await c.query(sql, params);
    await c.query('rollback to savepoint p');
    return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query('rollback to savepoint p');
    return { ok: false, code: (e as { code?: string }).code ?? 'unknown' };
  }
}

// Apply a proposed change as the table owner inside a savepoint, run fn, then undo it.
async function simulated<T>(ddl: string, fn: () => Promise<T>): Promise<T> {
  await c.query('savepoint sim');
  try {
    await c.query(ddl);
    return await fn();
  } finally {
    await c.query('rollback to savepoint sim');
  }
}

const q = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as Record<string, unknown>[];
const record = (k: string, v: unknown) => {
  obs[k] = v;
  return v;
};

beforeAll(async () => {
  if (!RUN) return;
  const env = requireLocalIntegrationEnv();
  pool = newPool(env, 'console-findings', 1);
  c = await pool.connect();
  c.on('notice', (n) => notices.push(`${n.severity ?? ''}: ${n.message}`));
  await c.query('begin');
  await c.query(`select set_config('lock_timeout', '5s', true)`);

  eventA = (await q(`select e.id from public.events e join public.campaigns cp on cp.event_id = e.id order by e.created_at desc limit 1`))[0]
    .id as string;
  const campaignId = (await q(`select id from public.campaigns where event_id = $1 limit 1`, [eventA]))[0].id;

  for (const [k, id] of Object.entries(ids)) {
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())`,
      [id, `${MARK}-${k.toLowerCase()}@kalfa.test`],
    );
  }
  const staff = { staffNotAgent: 'billing_clerk', agentNoVcd: 'auditor', agentInactive: 'billing_clerk', agentVcd: 'billing_clerk' } as const;
  for (const [k, role] of Object.entries(staff)) {
    await c.query(`insert into public.platform_staff (user_id, role_id, granted_by) select $1, id, $1 from public.platform_roles where name = $2`, [
      ids[k as keyof typeof staff],
      role,
    ]);
  }
  for (const k of AGENTS) {
    await c.query(`insert into public.console_agents (user_id, display_name, vox_active, vox_username) values ($1, $2, $3, $4)`, [
      ids[k],
      `${MARK}-${k}`,
      k !== 'agentInactive',
      `${MARK}-${k.toLowerCase()}`,
    ]);
    await c.query(`insert into public.console_agent_secrets (user_id, vox_password) values ($1, $2)`, [ids[k], `${MARK}-secret-${k}`]);
    await c.query(`insert into public.agent_status (agent_id) values ($1)`, [ids[k]]);
  }

  // Event A fixtures (in scope).
  const contactA = (await q(`insert into public.contacts (event_id, normalized_phone) values ($1, $2) returning id`, [eventA, PHONE]))[0].id;
  const guestA = (
    await q(`insert into public.guests (event_id, full_name, phone, contact_id) values ($1, $2, '0500009922', $3) returning id`, [eventA, `${MARK}-guestA`, contactA])
  )[0].id;
  await c.query(`insert into public.outreach_state (event_id, campaign_id, contact_id) values ($1, $2, $3)`, [eventA, campaignId, contactA]);
  await c.query(`insert into public.rsvp_responses (guest_id, event_id, attending, adults, kids, note) values ($1, $2, true, 2, 1, $3)`, [guestA, eventA, `${MARK}-noteA`]);
  const attempt = (
    await q(
      `insert into public.call_attempts (event_id, campaign_id, contact_id, guest_id, touchpoint_index, access_token, token_expires_at)
       values ($1, $2, $3, $4, 0, $5, now() + interval '1 day') returning id`,
      [eventA, campaignId, contactA, guestA, `${MARK}-token`],
    )
  )[0].id;
  await c.query(
    `insert into public.call_analysis (conversation_id, call_attempt_id, attempt_table, attempt_id, linked_at, event_id, el_data)
     values ($1, $2, 'call_attempts', $2, now(), $3, '{"status":"attending","adults":"2","children":"1"}')`,
    [`${MARK}-conv`, attempt, eventA],
  );
  // A trigger on call_attempts already created the feed row; set the RSVP digit on it.
  const feed = await c.query(`update public.console_call_feed set rsvp_digit = '1', event_id = $2 where call_attempt_id = $1`, [attempt, eventA]);
  if (feed.rowCount !== 1) throw new Error(`expected the trigger-created console_call_feed row, got ${feed.rowCount}`);
  await c.query(
    `insert into public.console_calls (direction, kind, agent_id, event_id, guest_id, contact_id, call_attempt_id, caller_masked)
     values ('outbound', 'manual', $1, $2, $3, $4, $5, $6)`,
    [ids.agentVcd, eventA, guestA, contactA, attempt, `${MARK}-masked`],
  );
  await c.query(`insert into public.console_chat_messages (author_id, body) values ($1, $2)`, [ids.agentVcd, `${MARK}-chat`]);
  await c.query(`insert into public.call_dispatch_status (dispatch_id, event_id, contact_id, call_attempt_id) values ($1, $2, $3, $4)`, [
    randomUUID(),
    eventA,
    contactA,
    attempt,
  ]);
  await c.query(
    `insert into public.human_agent_call_legs (call_attempt_id, request_id, mode, status, agent_id) values ($1, $2, 'monitor', 'requested', $3)`,
    [attempt, randomUUID(), ids.agentVcd],
  );

  // Event B (out of console_events scope): no campaign, with_ai_calls false.
  eventB = (await q(`insert into public.events (owner_id, name, with_ai_calls) values ($1, $2, false) returning id`, [ids.regular, `${MARK}-eventB`]))[0]
    .id as string;
  const contactB = (await q(`insert into public.contacts (event_id, normalized_phone) values ($1, '+972500009933') returning id`, [eventB]))[0].id;
  const guestB = (
    await q(`insert into public.guests (event_id, full_name, phone, contact_id) values ($1, $2, '0500009933', $3) returning id`, [eventB, `${MARK}-guestB`, contactB])
  )[0].id;
  await c.query(`insert into public.rsvp_responses (guest_id, event_id, attending, adults, kids, note) values ($1, $2, false, 0, 0, $3)`, [guestB, eventB, `${MARK}-noteB`]);
});

afterAll(async () => {
  if (!RUN) return;
  try {
    await c?.query('rollback');
  } finally {
    c?.release();
    await pool?.end();
    if (OBS_PATH) writeFileSync(OBS_PATH, JSON.stringify({ mark: MARK, obs, notices }, null, 2));
  }
});

const n = (r: R) => (r.ok ? Number(r.rows[0]?.n ?? r.count) : r.code);

describe.skipIf(!RUN)(`console findings — behavioural verification (local, rolled back) [${MARK}]`, () => {
  it('V-01/P01/P02: console_me returns the INACTIVE agent its own row; regular and staff-not-agent get none', async () => {
    const sql = `select count(*)::int n from public.console_me`;
    const v = record('console_me', {
      agentInactive: n(await as('agentInactive', sql)),
      regular: n(await as('regular', sql)),
      staffNotAgent: n(await as('staffNotAgent', sql)),
    });
    expect(v).toEqual({ agentInactive: 1, regular: 0, staffNotAgent: 0 });
  });

  it('G2/P02: an INACTIVE agent cannot insert its shift row (42501); UPDATE with WHERE hits 0 rows (SELECT policy applies), UPDATE without WHERE is recorded', async () => {
    const ins = await as('agentInactive', `insert into public.console_agent_shift (agent_id, active) values ($1, true)`, [ids.agentInactive]);
    await c.query(`insert into public.console_agent_shift (agent_id, active) values ($1, false)`, [ids.agentInactive]);
    const upd = await as('agentInactive', `update public.console_agent_shift set active = true where agent_id = $1`, [ids.agentInactive]);
    const updNoWhere = await as('agentInactive', `update public.console_agent_shift set active = true`);
    const updReturning = await as('agentInactive', `update public.console_agent_shift set active = true returning agent_id`);
    const v = record('inactive_shift', {
      insert: ins.ok ? `ok:${ins.count}` : ins.code,
      update_where: upd.ok ? upd.count : upd.code,
      update_no_where: updNoWhere.ok ? updNoWhere.count : updNoWhere.code,
      update_no_where_returning: updReturning.ok ? updReturning.count : updReturning.code,
    });
    expect(v).toMatchObject({ insert: '42501', update_where: 0 });
  });

  it('G3/S-07: a non-agent gets different outcomes per operation (insert 42501, update/delete 0 rows, TRUNCATE allowed)', async () => {
    const v = record('nonagent_ops', {
      chat_insert: n(await as('regular', `insert into public.console_chat_messages (author_id, body) values ($1, 'x')`, [ids.regular])),
      shift_insert: n(await as('regular', `insert into public.console_agent_shift (agent_id, active) values ($1, true)`, [ids.regular])),
      agent_status_insert: n(await as('regular', `insert into public.agent_status (agent_id) values ($1)`, [ids.regular])),
      call_feed_update: n(await as('regular', `update public.console_call_feed set handled_by = 'ai' where event_id = $1`, [eventA])),
      shift_delete: n(await as('regular', `delete from public.console_agent_shift`)),
      shift_truncate: (await as('regular', `truncate public.console_agent_shift`)).ok ? 'ALLOWED' : 'refused',
      call_pii_select: n(await as('regular', `select count(*)::int n from public.console_call_pii`)),
    });
    expect(v).toEqual({
      chat_insert: '42501',
      shift_insert: '42501',
      agent_status_insert: '42501',
      call_feed_update: 0,
      shift_delete: 0,
      shift_truncate: 'ALLOWED',
      call_pii_select: '42501',
    });
  });

  it('G1/G6: authenticated holds MAINTAIN on console_agent_shift (ANALYZE runs without a permission warning)', async () => {
    notices.length = 0;
    const r = await as('regular', `analyze public.console_agent_shift`);
    const warned = notices.some((m) => /permission denied/i.test(m));
    record('maintain_analyze', { ok: r.ok, warned, notices: [...notices] });
    expect(r.ok).toBe(true);
    expect(warned).toBe(false);
    // Control: anon has no MAINTAIN and gets a refusal or a skip warning.
    notices.length = 0;
    const a = await as('anon', `analyze public.console_agent_shift`);
    const anonWarned = !a.ok || notices.some((m) => /permission denied/i.test(m));
    record('maintain_analyze_anon_refused', anonWarned);
    expect(anonWarned).toBe(true);
  });

  it('V-02: an active agent reads guests and RSVP answers of an event OUTSIDE the console_events scope', async () => {
    const v = record('scope_eventB', {
      console_events: n(await as('agentNoVcd', `select count(*)::int n from public.console_events where event_id = $1`, [eventB])),
      console_event_guests: n(await as('agentNoVcd', `select count(*)::int n from public.console_event_guests where event_id = $1 and guest_name = $2`, [eventB, `${MARK}-guestB`])),
      console_rsvp_results: n(await as('agentNoVcd', `select count(*)::int n from public.console_rsvp_results where event_id = $1 and note = $2`, [eventB, `${MARK}-noteB`])),
    });
    expect(v).toEqual({ console_events: 0, console_event_guests: 1, console_rsvp_results: 1 });
  });

  it('V-04/S-01: the roster reports provisioned=true for every fixture agent, computed from console_agent_secrets', async () => {
    const r = await as('agentNoVcd', `select user_id::text, provisioned from public.console_agents_roster where user_id = any($1::uuid[])`, [Object.values(ids)]);
    const v = record('roster_today', r.ok ? Object.fromEntries(r.rows.map((x) => [Object.entries(ids).find(([, id]) => id === x.user_id)?.[0], x.provisioned])) : r.code);
    // The roster's own WHERE is_console_agent() + base RLS: the inactive agent's row is still listed?
    expect(v).toMatchObject({ agentNoVcd: true, agentVcd: true });
  });

  it('S-01/W-04/P11 (simulated D4 main option): own-row secrets policy makes every COLLEAGUE provisioned=false', async () => {
    const v = await simulated(
      `drop policy console_agent_secrets_select on public.console_agent_secrets;
       create policy console_agent_secrets_select on public.console_agent_secrets for select to authenticated
         using (user_id = (select auth.uid()) and (select public.is_console_agent()))`,
      async () => {
        const r = await as('agentNoVcd', `select user_id::text, provisioned from public.console_agents_roster where user_id = any($1::uuid[])`, [Object.values(ids)]);
        return r.ok ? Object.fromEntries(r.rows.map((x) => [Object.entries(ids).find(([, id]) => id === x.user_id)?.[0], x.provisioned])) : r.code;
      },
    );
    record('roster_d4_own_row', v);
    expect(v).toMatchObject({ agentNoVcd: true, agentVcd: false });
  });

  it('S-01/W-04/P11 (simulated D4 alternative): revoking the user_id column grant makes the roster query fail with 42501', async () => {
    const v = await simulated(`revoke select (user_id) on public.console_agent_secrets from authenticated`, async () =>
      n(await as('agentNoVcd', `select count(*)::int n from public.console_agents_roster`)),
    );
    record('roster_d4_revoke', v);
    expect(v).toBe('42501');
  });

  it('V-08/P20: an agent WITHOUT view_customer_data reads rsvp_digit, chat body and console_calls guest/contact/caller columns', async () => {
    const v = record('table_pii_noVcd', {
      rsvp_digit: n(await as('agentNoVcd', `select count(*)::int n from public.console_call_feed where event_id = $1 and rsvp_digit = '1'`, [eventA])),
      chat_body: n(await as('agentNoVcd', `select count(*)::int n from public.console_chat_messages where body = $1`, [`${MARK}-chat`])),
      console_calls: n(
        await as('agentNoVcd', `select count(*)::int n from public.console_calls where caller_masked = $1 and guest_id is not null and contact_id is not null`, [
          `${MARK}-masked`,
        ]),
      ),
    });
    expect(v).toEqual({ rsvp_digit: 1, chat_body: 1, console_calls: 1 });
  });

  it('P04: a key holder (agentVcd) also reads RSVP notes and call analysis (previously not asserted)', async () => {
    const v = record('vcd_notes_analysis', {
      note: n(await as('agentVcd', `select count(*)::int n from public.console_rsvp_results where event_id = $1 and note = $2`, [eventA, `${MARK}-noteA`])),
      analysis: n(await as('agentVcd', `select count(*)::int n from public.console_call_analysis where event_id = $1 and rsvp_status = 'attending'`, [eventA])),
    });
    expect(v).toEqual({ note: 1, analysis: 1 });
  });

  it('S-05/S-06/P16: console_call_pii and console_agent_commands refuse SELECT/INSERT/UPDATE/DELETE to every persona', async () => {
    const out: Record<string, string> = {};
    for (const t of ['console_call_pii', 'console_agent_commands']) {
      for (const who of ['anon', 'regular', 'staffNotAgent', 'agentNoVcd', 'agentInactive', 'agentVcd'] as const) {
        const codes = [
          await as(who, `select 1 from public.${t} limit 1`),
          await as(who, `insert into public.${t} default values`),
          await as(who, `update public.${t} set created_at = created_at`),
          await as(who, `delete from public.${t}`),
        ].map((r) => (r.ok ? 'ok' : r.code));
        out[`${t}:${who}`] = codes.join(',');
      }
    }
    record('closed_tables', out);
    for (const v of Object.values(out)) expect(v).toBe('42501,42501,42501,42501');
  });

  it('S-06 (simulated): with RLS DISABLED on console_call_pii the client still gets 42501 — 42501 alone does not prove RLS', async () => {
    const v = await simulated(`alter table public.console_call_pii disable row level security`, async () =>
      n(await as('agentVcd', `select count(*)::int n from public.console_call_pii`)),
    );
    record('pii_rls_off', v);
    expect(v).toBe('42501');
  });

  it('G5/P24: the three non-prefixed tables are gated by is_console_agent() for clients', async () => {
    const v = record('nonprefixed', {
      agent_status_agentNoVcd: n(await as('agentNoVcd', `select count(*)::int n from public.agent_status where agent_id = any($1::uuid[])`, [Object.values(ids)])),
      agent_status_regular: n(await as('regular', `select count(*)::int n from public.agent_status where agent_id = any($1::uuid[])`, [Object.values(ids)])),
      dispatch_agentNoVcd: n(await as('agentNoVcd', `select count(*)::int n from public.call_dispatch_status where event_id = $1`, [eventA])),
      dispatch_regular: n(await as('regular', `select count(*)::int n from public.call_dispatch_status where event_id = $1`, [eventA])),
      legs_agentVcd_own: n(await as('agentVcd', `select count(*)::int n from public.human_agent_call_legs where agent_id = $1`, [ids.agentVcd])),
      legs_agentNoVcd_other: n(await as('agentNoVcd', `select count(*)::int n from public.human_agent_call_legs where agent_id = $1`, [ids.agentVcd])),
    });
    expect(v).toEqual({
      agent_status_agentNoVcd: 3,
      agent_status_regular: 0,
      dispatch_agentNoVcd: 1,
      dispatch_regular: 0,
      legs_agentVcd_own: 1,
      legs_agentNoVcd_other: 0,
    });
  });

  it('G11 (simulated D3): is_console_agent() with search_path = \'\' still answers correctly', async () => {
    const v = await simulated(`alter function public.is_console_agent() set search_path = ''`, async () => ({
      agentVcd: (await as('agentVcd', `select public.is_console_agent() v`)) as R,
      agentInactive: (await as('agentInactive', `select public.is_console_agent() v`)) as R,
      regular: (await as('regular', `select public.is_console_agent() v`)) as R,
    }));
    const flat = Object.fromEntries(Object.entries(v).map(([k, r]) => [k, r.ok ? r.rows[0].v : r.code]));
    record('search_path_empty', flat);
    expect(flat).toEqual({ agentVcd: true, agentInactive: false, regular: false });
  });

  it('V-10: every active agent reads every console_agents row (colleague directory)', async () => {
    const v = record('agents_directory', n(await as('agentNoVcd', `select count(*)::int n from public.console_agents where user_id = any($1::uuid[])`, [Object.values(ids)])));
    expect(v).toBe(3);
  });

  it('G8/W-03: an active agent may SELECT console_queues/agent_queues/presence at the DB layer but not INSERT', async () => {
    const v = record('queues', {
      select_queues: (await as('agentVcd', `select count(*)::int n from public.console_queues`)).ok,
      select_agent_queues: (await as('agentVcd', `select count(*)::int n from public.console_agent_queues`)).ok,
      select_presence: (await as('agentVcd', `select count(*)::int n from public.console_agent_calendar_presence`)).ok,
      insert_queues: n(await as('agentVcd', `insert into public.console_queues default values`)),
    });
    expect(v).toEqual({ select_queues: true, select_agent_queues: true, select_presence: true, insert_queues: '42501' });
  });
});

// ── Proposed design, simulated (each block: apply inside a SAVEPOINT, observe as clients, roll back) ──

const ROSTER_NEW = `
  create function public.console_agent_provisioned(p_user_id uuid) returns boolean
    language sql stable security definer set search_path = ''
    as $f$ select (select public.is_console_agent())
              and exists (select 1 from public.console_agent_secrets s where s.user_id = p_user_id) $f$;
  revoke all on function public.console_agent_provisioned(uuid) from public, anon;
  grant execute on function public.console_agent_provisioned(uuid) to authenticated;
  create or replace view public.console_agents_roster with (security_invoker = on) as
    select ca.user_id, ca.display_name, coalesce(ast.status, 'not_ready'::text) as status,
           ast.updated_at as status_updated_at,
           ((ca.vox_username is not null) and public.console_agent_provisioned(ca.user_id)) as provisioned,
           cp.busy_until as calendar_busy_until, cp.show_as as calendar_show_as
      from public.console_agents ca
      left join public.agent_status ast on ast.agent_id = ca.user_id
      left join public.console_agent_calendar_presence cp on cp.agent_id = ca.user_id
     where public.is_console_agent();
  drop policy console_agent_secrets_select on public.console_agent_secrets;
  revoke all on public.console_agent_secrets from anon, authenticated;`;

const rosterMap = async (who: Persona) => {
  const r = await as(who, `select user_id::text, provisioned from public.console_agents_roster where user_id = any($1::uuid[])`, [Object.values(ids)]);
  return r.ok ? Object.fromEntries(r.rows.map((x) => [Object.entries(ids).find(([, id]) => id === x.user_id)?.[0], x.provisioned])) : r.code;
};

describe.skipIf(!RUN)(`console design — simulated proposals (local, rolled back) [${MARK}]`, () => {
  it('NEW D4: provisioned via a definer helper keeps the roster identical while console_agent_secrets closes to every client', async () => {
    const before = { agentNoVcd: await rosterMap('agentNoVcd'), agentVcd: await rosterMap('agentVcd') };
    const after = await simulated(ROSTER_NEW, async () => ({
      roster_agentNoVcd: await rosterMap('agentNoVcd'),
      roster_agentVcd: await rosterMap('agentVcd'),
      roster_regular: n(await as('regular', `select count(*)::int n from public.console_agents_roster`)),
      roster_anon: n(await as('anon', `select count(*)::int n from public.console_agents_roster`)),
      secrets_user_id_agent: n(await as('agentVcd', `select count(*)::int n from public.console_agent_secrets`)),
      secrets_password_agent: n(await as('agentVcd', `select vox_password from public.console_agent_secrets`)),
      rpc_regular: (await as('regular', `select public.console_agent_provisioned($1) v`, [ids.agentVcd])) as R,
      rpc_anon: n(await as('anon', `select public.console_agent_provisioned($1) v`, [ids.agentVcd])),
    }));
    const flat = { ...after, rpc_regular: after.rpc_regular.ok ? after.rpc_regular.rows[0].v : after.rpc_regular.code };
    record('sim_new_d4', { before, after: flat });
    expect(flat.roster_agentNoVcd).toEqual(before.agentNoVcd);
    expect(flat.roster_agentVcd).toEqual(before.agentVcd);
    expect(flat).toMatchObject({ roster_regular: 0, roster_anon: '42501', secrets_user_id_agent: '42501', secrets_password_agent: '42501', rpc_regular: false, rpc_anon: '42501' });
  });

  it('NEW D4: an agent WITHOUT a secret still shows provisioned=false (semantics preserved)', async () => {
    const v = await simulated(`${ROSTER_NEW} delete from public.console_agent_secrets where user_id = '${ids.agentInactive}';`, async () => rosterMap('agentNoVcd'));
    record('sim_new_d4_no_secret', v);
    expect(v).toMatchObject({ agentNoVcd: true, agentVcd: true, agentInactive: false });
  });

  it('NEW scope rule: guests/RSVP limited to console-scope events — in-scope work unchanged, out-of-scope event hidden', async () => {
    const g = (await q(`select pg_get_viewdef('public.console_event_guests') d`))[0].d as string;
    const r = (await q(`select pg_get_viewdef('public.console_rsvp_results') d`))[0].d as string;
    const replaceWhere = (d: string, col: string) => {
      if (!/WHERE is_console_agent\(\);\s*$/.test(d)) throw new Error('unexpected view tail');
      return d.replace(/WHERE is_console_agent\(\);\s*$/, `WHERE is_console_agent() AND public.console_event_in_scope(${col});`);
    };
    const ddl = `
      create function public.console_event_in_scope(p_event_id uuid) returns boolean
        language sql stable security definer set search_path = ''
        as $f$ select (select public.is_console_agent()) and exists (
                 select 1 from public.events e where e.id = p_event_id
                   and (e.with_ai_calls or exists (select 1 from public.campaigns c where c.event_id = e.id))) $f$;
      revoke all on function public.console_event_in_scope(uuid) from public, anon;
      grant execute on function public.console_event_in_scope(uuid) to authenticated;
      create or replace view public.console_event_guests as ${replaceWhere(g, 'g.event_id')}
      create or replace view public.console_rsvp_results as ${replaceWhere(r, 'r.event_id')}`;
    const v = await simulated(ddl, async () => ({
      guests_A: n(await as('agentNoVcd', `select count(*)::int n from public.console_event_guests where event_id = $1 and guest_name = $2`, [eventA, `${MARK}-guestA`])),
      guests_B: n(await as('agentNoVcd', `select count(*)::int n from public.console_event_guests where event_id = $1`, [eventB])),
      rsvp_A: n(await as('agentNoVcd', `select count(*)::int n from public.console_rsvp_results where event_id = $1 and note = $2`, [eventA, `${MARK}-noteA`])),
      rsvp_B: n(await as('agentNoVcd', `select count(*)::int n from public.console_rsvp_results where event_id = $1`, [eventB])),
      phone_A_vcd: n(await as('agentVcd', `select count(*)::int n from public.console_event_guests where event_id = $1 and phone = $2`, [eventA, PHONE])),
      phone_A_noVcd: n(await as('agentNoVcd', `select count(*)::int n from public.console_event_guests where event_id = $1 and phone is not null`, [eventA])),
      regular: n(await as('regular', `select count(*)::int n from public.console_event_guests`)),
    }));
    record('sim_scope', v);
    expect(v).toEqual({ guests_A: 1, guests_B: 0, rsvp_A: 1, rsvp_B: 0, phone_A_vcd: 1, phone_A_noVcd: 0, regular: 0 });
  });

  it('NEW shift hardening: rebuilt grants + is_console_agent() on update keep the PostgREST upsert working and close TRUNCATE/MAINTAIN', async () => {
    const ddl = `
      revoke all on public.console_agent_shift from anon, authenticated;
      grant select on public.console_agent_shift to authenticated;
      grant insert (agent_id, active, updated_at), update (agent_id, active, updated_at) on public.console_agent_shift to authenticated;
      alter policy console_agent_shift_update_own on public.console_agent_shift
        using (agent_id = (select auth.uid()) and (select public.is_console_agent()))
        with check (agent_id = (select auth.uid()) and (select public.is_console_agent()));`;
    // The statement shape PostgREST sends for .upsert({...}, { onConflict: 'agent_id' }) — with RETURNING, as PostgREST does.
    const upsert = `with s as (insert into public.console_agent_shift (agent_id, active, updated_at) values ($1, $2, now())
                    on conflict (agent_id) do update set agent_id = excluded.agent_id, active = excluded.active, updated_at = excluded.updated_at
                    returning 1) select count(*)::int n from s`;
    const v = await simulated(ddl, async () => {
      await c.query(`insert into public.console_agent_shift (agent_id, active) values ($1, false) on conflict (agent_id) do nothing`, [ids.agentInactive]);
      const insertPath = n(await as('agentVcd', upsert, [ids.agentVcd, true]));
      await c.query(`insert into public.console_agent_shift (agent_id, active) values ($1, false) on conflict (agent_id) do nothing`, [ids.agentVcd]);
      return {
        active_upsert_insert_path: insertPath,
        active_upsert_conflict_path: n(await as('agentVcd', upsert, [ids.agentVcd, true])),
        inactive_upsert: n(await as('agentInactive', upsert, [ids.agentInactive, true])),
        inactive_update_no_where: n(await as('agentInactive', `update public.console_agent_shift set active = true`)),
        regular_truncate: n(await as('regular', `truncate public.console_agent_shift`)),
        maintain: (await q(`select has_table_privilege('authenticated', 'public.console_agent_shift', 'MAINTAIN') v`))[0].v,
        trigger: (await q(`select has_table_privilege('authenticated', 'public.console_agent_shift', 'TRIGGER') v`))[0].v,
      };
    });
    record('sim_shift', v);
    expect(v).toEqual({
      active_upsert_insert_path: 1,
      active_upsert_conflict_path: 1,
      inactive_upsert: '42501',
      inactive_update_no_where: 0,
      regular_truncate: '42501',
      maintain: false,
      trigger: false,
    });
  });
});
