// casl-console-ability-foundation: the "permissions changed" signal, executed live against the LOCAL stack.
// Real local Realtime (ws://127.0.0.1:54321), real GoTrue users, COMMITTED fixtures: a database broadcast is delivered
// from committed realtime.messages rows, so a rolled-back transaction cannot be used.
//
// What it proves (migration 20261022100542_platform_permission_change_signal):
//   - authorisation: a user joins their own private topic staff:<uid>; joining another user's topic is refused;
//   - fan-out: a role-permission change reaches every holder of that role and nobody else;
//   - a console_agents change (the softphone gate) reaches only that agent; a display_name-only update sends nothing;
//   - the payload carries nothing but the id realtime.send adds;
//   - Broadcast Replay: a signal sent while the user was not connected arrives on join, marked replayed, and a join
//     from a later `since` replays nothing (the mechanism src/lib/realtime/permission-changes.ts relies on).
// The topic and event names come from src/lib/realtime/permission-changes.ts, the module the admin page uses.
// Isolation: a fixture platform role (it-<tag>) is created so a change reaches only fixture users. Cleanup removes the
// role's permission rows, the users (platform_staff and console_agents cascade), the role's audit rows, the role, and
// every realtime.messages row on the fixture topics; afterAll then asserts none of those rows is left.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Pool } from 'pg';

import { type AuthUser, FixtureScope, newPool, requireLocalIntegrationEnv } from '@/lib/testing/local-integration';
import { PERMISSIONS_CHANGED_EVENT, permissionTopic } from '@/lib/realtime/permission-changes';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV = RUN ? requireLocalIntegrationEnv() : null;
type Who = 'a' | 'b' | 'c';
type Got = { mark: string | null; payloadKeys: string[]; replayed: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)('permission-change signal, live (local)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let users: Record<Who, AuthUser>;
  let roleId = '';
  let permissionId = '';
  const roleName = `it-${randomUUID().slice(0, 8)}`;
  const channels: Array<{ user: AuthUser; ch: RealtimeChannel }> = [];
  const got: Record<Who, Got[]> = { a: [], b: [], c: [] };
  let intrusion: { status: string; error: string } | null = null;

  async function waitFor(pred: () => boolean, ms: number) {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await sleep(100);
    return pred();
  }

  async function join(
    user: AuthUser,
    topic: string,
    sink: Got[] | null,
    replay?: { since: number; limit: number },
  ): Promise<{ status: string; error: string }> {
    await user.client.realtime.setAuth(user.session.access_token);
    return new Promise((resolve) => {
      const ch = user.client
        .channel(topic, { config: { private: true, ...(replay ? { broadcast: { replay } } : {}) } })
        .on('broadcast', { event: PERMISSIONS_CHANGED_EVENT }, (msg) => {
          const payload = (msg.payload ?? {}) as Record<string, unknown>;
          sink?.push({
            mark: typeof payload.mark === 'string' ? payload.mark : null,
            payloadKeys: Object.keys(payload).sort(),
            replayed: msg.meta?.replayed === true,
          });
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            resolve({ status, error: err?.message ?? '' });
          }
        });
      channels.push({ user, ch });
    });
  }

  const topics = () => Object.values(users).map((u) => permissionTopic(u.id));
  const clear = () => (Object.keys(got) as Who[]).forEach((w) => (got[w].length = 0));

  beforeAll(async () => {
    if (!RUN) return;
    if (!ENV!.anonKey) throw new Error('permission-signal: the local anon key is required');
    pool = newPool(ENV!, 'permission-signal', 2);
    scope = new FixtureScope(pool);
    roleId = (
      await pool.query(`insert into public.platform_roles (name, label) values ($1, $1) returning id`, [roleName])
    ).rows[0].id as string;
    permissionId = (await pool.query(`select id from public.platform_permission_definitions order by key limit 1`)).rows[0]
      .id as string;
    users = {
      a: await scope.createAuthUser(ENV!, { staffRole: roleName }),
      b: await scope.createAuthUser(ENV!, { staffRole: roleName }),
      c: await scope.createAuthUser(ENV!),
    };

    for (const who of ['a', 'b', 'c'] as const) {
      const r = await join(users[who], permissionTopic(users[who].id), got[who]);
      if (r.status !== 'SUBSCRIBED') throw new Error(`permission-signal: ${who} could not join its own topic (${r.status} ${r.error})`);
    }
    // A database broadcast reaches the socket some time after SUBSCRIBED. Warm up with marked test messages until A
    // receives one; they are deleted with the other rows on the fixture topics.
    let warmed = false;
    for (let i = 0; i < 20 && !warmed; i++) {
      const mark = `warmup-${i}`;
      await pool.query(`select realtime.send(jsonb_build_object('mark', $1::text), $2, $3, true)`, [
        mark,
        PERMISSIONS_CHANGED_EVENT,
        permissionTopic(users.a.id),
      ]);
      warmed = await waitFor(() => got.a.some((g) => g.mark === mark), 1500);
    }
    if (!warmed) throw new Error('permission-signal: A never received a warm-up broadcast (Realtime not delivering)');
    clear();
  });

  afterAll(async () => {
    if (!RUN) return;
    for (const { user, ch } of channels) await user.client.removeChannel(ch).catch(() => {});
    try {
      if (roleId) await pool.query(`delete from public.platform_role_permissions where role_id = $1`, [roleId]);
    } finally {
      await scope?.cleanup();
      if (roleId) {
        await pool.query(`delete from public.platform_role_audit_log where target_role_id = $1`, [roleId]);
        await pool.query(`delete from public.platform_roles where id = $1`, [roleId]);
      }
      if (users) await pool.query(`delete from realtime.messages where topic = any($1::text[])`, [topics()]);
      // Residue check on what FixtureScope does not own: fail the run loudly if anything is left.
      const left = await pool.query(
        `select (select count(*) from realtime.messages where topic = any($1::text[]))::int as messages,
                (select count(*) from public.platform_roles where id = $2)::int as roles,
                (select count(*) from public.platform_role_audit_log where target_role_id = $2)::int as audit`,
        [users ? topics() : [], roleId || null],
      );
      await pool?.end();
      expect(left.rows[0]).toEqual({ messages: 0, roles: 0, audit: 0 });
    }
  });

  it("a user cannot join another user's topic", async () => {
    intrusion = await join(users.c, permissionTopic(users.a.id), null);
    expect(intrusion.status, `C joined A's topic: ${JSON.stringify(intrusion)}`).not.toBe('SUBSCRIBED');
  });

  it('a role-permission change reaches every holder of the role, with an empty payload, and nobody else', async () => {
    await pool.query(`insert into public.platform_role_permissions (role_id, permission_id) values ($1, $2)`, [roleId, permissionId]);
    expect(await waitFor(() => got.a.length >= 1 && got.b.length >= 1, 10_000), JSON.stringify(got)).toBe(true);
    await sleep(2000);
    expect(got.a).toEqual([{ mark: null, payloadKeys: ['id'], replayed: false }]);
    expect(got.b).toEqual([{ mark: null, payloadKeys: ['id'], replayed: false }]);
    expect(got.c).toEqual([]);

    clear();
    await pool.query(`delete from public.platform_role_permissions where role_id = $1 and permission_id = $2`, [roleId, permissionId]);
    expect(await waitFor(() => got.a.length >= 1 && got.b.length >= 1, 10_000), JSON.stringify(got)).toBe(true);
    await sleep(2000);
    expect({ a: got.a.length, b: got.b.length, c: got.c.length }).toEqual({ a: 1, b: 1, c: 0 });
  });

  it('a console_agents change reaches only that agent; a display_name-only update sends nothing', async () => {
    clear();
    await pool.query(
      `insert into public.console_agents (user_id, display_name, vox_active, vox_username) values ($1, $2, false, $2)`,
      [users.a.id, `${users.a.tag}-agent`],
    );
    expect(await waitFor(() => got.a.length >= 1, 10_000), JSON.stringify(got)).toBe(true);
    await pool.query(`update public.console_agents set vox_active = true where user_id = $1`, [users.a.id]);
    expect(await waitFor(() => got.a.length >= 2, 10_000), JSON.stringify(got)).toBe(true);
    await sleep(2000);
    expect({ a: got.a.length, b: got.b.length, c: got.c.length }).toEqual({ a: 2, b: 0, c: 0 });

    clear();
    await pool.query(`update public.console_agents set display_name = display_name || '-x' where user_id = $1`, [users.a.id]);
    await sleep(3000);
    expect({ a: got.a.length, b: got.b.length, c: got.c.length }).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('control: the refused intruder is not a broken client (C still receives on its own topic)', async () => {
    clear();
    await pool.query(`select realtime.send('{}'::jsonb, $1, $2, true)`, [PERMISSIONS_CHANGED_EVENT, permissionTopic(users.c.id)]);
    expect(await waitFor(() => got.c.length >= 1, 10_000), JSON.stringify(got)).toBe(true);
  });

  it('Broadcast Replay: a signal sent while B was not connected is delivered on join, marked replayed; none before `since`', async () => {
    // B leaves (the page is closed or the socket is down), then the role changes.
    const live = channels.find((c) => c.user === users.b && c.ch.topic === `realtime:${permissionTopic(users.b.id)}`)!;
    await users.b.client.removeChannel(live.ch);
    const dbNow = async () => Number((await pool.query(`select (extract(epoch from clock_timestamp()) * 1000)::bigint as t`)).rows[0].t);
    const since = await dbNow();
    await sleep(50);
    await pool.query(`insert into public.platform_role_permissions (role_id, permission_id) values ($1, $2)`, [roleId, permissionId]);
    await sleep(50);
    const after = await dbNow();

    // B joins again with replay from before the change: the missed signal arrives, marked replayed.
    const replayed: Got[] = [];
    const r = await join(users.b, permissionTopic(users.b.id), replayed, { since, limit: 1 });
    expect(r.status, JSON.stringify(r)).toBe('SUBSCRIBED');
    expect(await waitFor(() => replayed.length >= 1, 10_000), JSON.stringify(replayed)).toBe(true);
    expect(replayed[0]).toEqual({ mark: null, payloadKeys: ['id'], replayed: true });

    // Control: a join from after the change replays nothing.
    const again = channels.findLast((c) => c.user === users.b)!;
    await users.b.client.removeChannel(again.ch);
    const none: Got[] = [];
    const r2 = await join(users.b, permissionTopic(users.b.id), none, { since: after, limit: 1 });
    expect(r2.status, JSON.stringify(r2)).toBe('SUBSCRIBED');
    await sleep(3000);
    expect(none).toEqual([]);
  });
});
