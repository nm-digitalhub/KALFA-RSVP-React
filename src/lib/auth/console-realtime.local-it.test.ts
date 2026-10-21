// harden-console-agent-permissions, spec "Console workflows keep working" › Scenario: Realtime — executed live.
// Real local Realtime (ws://127.0.0.1:54321), real GoTrue users, COMMITTED fixtures: Realtime evaluates each
// subscriber's RLS against committed rows with that subscriber's JWT, so a rolled-back transaction cannot be used.
//
// What it proves, per published table console_chat_messages, console_calls, console_call_feed:
//   - an ACTIVE agent receives the change;
//   - an INACTIVE agent and a regular user receive nothing (is_console_agent() select policies);
//   - control: after the inactive agent is activated, the same subscription receives the next change, so the
//     negative result is not a broken subscription.
// Cleanup: the chat and console_calls rows are deleted by exact id first (console_chat_messages.author_id is
// ON DELETE RESTRICT to console_agents), then FixtureScope removes the event tree and the users (console_agents
// and platform_staff cascade from auth.users). The run-local.sh fingerprint proves nothing is left.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Pool } from 'pg';

import { type AuthUser, type Fixture, FixtureScope, newPool, requireLocalIntegrationEnv } from '@/lib/testing/local-integration';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV = RUN ? requireLocalIntegrationEnv() : null;
const TABLES = ['console_chat_messages', 'console_calls', 'console_call_feed'] as const;
type Table = (typeof TABLES)[number];
type Who = 'active' | 'inactive' | 'regular';
type Got = { table: Table; type: string; key: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)('console Realtime delivery, live (local)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let users: Record<Who, AuthUser>;
  let f: Fixture;
  const channels: Array<{ user: AuthUser; ch: RealtimeChannel }> = [];
  const got: Record<Who, Got[]> = { active: [], inactive: [], regular: [] };
  const chatIds: string[] = [];
  const callIds: string[] = [];
  let mark = '';

  // Row key per table, so a received event can be matched to what this test wrote.
  const keyOf = (table: Table, row: Record<string, unknown>) => String(table === 'console_call_feed' ? row.call_attempt_id : row.id);

  async function waitFor(pred: () => boolean, ms: number) {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await sleep(100);
    return pred();
  }
  const seen = (who: Who, table: Table, key: string) => got[who].some((g) => g.table === table && g.key === key);

  beforeAll(async () => {
    if (!RUN) return;
    if (!ENV!.anonKey) throw new Error('console-realtime: the local anon key is required');
    pool = newPool(ENV!, 'console-realtime', 2);
    scope = new FixtureScope(pool);
    users = {
      active: await scope.createAuthUser(ENV!, { staffRole: 'ops_engineer' }),
      inactive: await scope.createAuthUser(ENV!, { staffRole: 'ops_engineer' }),
      regular: await scope.createAuthUser(ENV!),
    };
    mark = users.active.tag;
    for (const [who, active] of [['active', true], ['inactive', false]] as const) {
      await pool.query(`insert into public.console_agents (user_id, display_name, vox_active, vox_username) values ($1, $2, $3, $4)`, [
        users[who].id,
        `${mark}-${who}`,
        active,
        `${mark}-${who}`,
      ]);
    }
    f = await scope.create();

    for (const who of ['active', 'inactive', 'regular'] as const) {
      const user = users[who];
      await user.client.realtime.setAuth(user.session.access_token);
      const ready = new Promise<void>((resolve, reject) => {
        let ch = user.client.channel(`it-console-${who}-${mark}`);
        for (const table of TABLES) {
          ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
            const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as Record<string, unknown>;
            got[who].push({ table, type: p.eventType, key: keyOf(table, row) });
          });
        }
        ch.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`${who} subscribe ${status} ${err?.message ?? ''}`));
        });
        channels.push({ user, ch });
      });
      await ready;
    }
    // Realtime attaches the postgres_changes subscriptions some time after SUBSCRIBED (a fixed 1.5 s wait was not
    // enough: the first run received nothing in test 1 while test 2 passed). Warm up with probe chat rows until
    // the active agent receives one; the probes are deleted with the other chat rows.
    let warmed = false;
    for (let i = 0; i < 20 && !warmed; i++) {
      const probe = (
        await pool.query(`insert into public.console_chat_messages (author_id, body) values ($1, $2) returning id`, [users.active.id, `${mark}-warmup-${i}`])
      ).rows[0].id as string;
      chatIds.push(probe);
      warmed = await waitFor(() => seen('active', 'console_chat_messages', probe), 1500);
    }
    if (!warmed) throw new Error('console-realtime: the active agent never received a warm-up change (Realtime not delivering)');
    for (const who of ['active', 'inactive', 'regular'] as const) got[who].length = 0;
  });

  afterAll(async () => {
    if (!RUN) return;
    for (const { user, ch } of channels) await user.client.removeChannel(ch).catch(() => {});
    try {
      if (chatIds.length) await pool.query(`delete from public.console_chat_messages where id = any($1::uuid[])`, [chatIds]);
      if (callIds.length) await pool.query(`delete from public.console_calls where id = any($1::uuid[])`, [callIds]);
    } finally {
      await scope?.cleanup();
      await pool?.end();
    }
  });

  it('an ACTIVE agent receives inserts and updates on all three tables; an inactive agent and a regular user receive nothing', async () => {
    const chat = (await pool.query(`insert into public.console_chat_messages (author_id, body) values ($1, $2) returning id`, [users.active.id, `${mark}-chat`]))
      .rows[0].id as string;
    chatIds.push(chat);
    const call = (
      await pool.query(`insert into public.console_calls (direction, kind, status, caller_masked) values ('outbound', 'manual', 'ringing', $1) returning id`, [
        `${mark}-masked`,
      ])
    ).rows[0].id as string;
    callIds.push(call);
    await pool.query(`update public.console_calls set status = 'connected' where id = $1`, [call]);
    const attempt = (
      await pool.query(
        `insert into public.call_attempts (event_id, campaign_id, contact_id, guest_id, touchpoint_index, access_token, token_expires_at)
         values ($1, $2, $3, $4, 0, $5, now() + interval '1 day') returning id`,
        [f.eventId, f.campaignId, f.contactId, f.guestId, `${mark}-token`],
      )
    ).rows[0].id as string;
    const feed = await pool.query(`update public.console_call_feed set status = 'in-progress' where call_attempt_id = $1`, [attempt]);
    expect(feed.rowCount, 'the trigger creates the console_call_feed row').toBe(1);

    const all = () =>
      seen('active', 'console_chat_messages', chat) &&
      got.active.filter((g) => g.table === 'console_calls' && g.key === call).length >= 2 &&
      seen('active', 'console_call_feed', attempt);
    expect(await waitFor(all, 10_000), `active agent events: ${JSON.stringify(got.active)}`).toBe(true);
    // Give the negative side the same window again before concluding nothing arrives.
    await sleep(3000);
    const ours = (who: Who) => got[who].filter((g) => [chat, call, attempt].includes(g.key));
    expect({ inactive: ours('inactive'), regular: ours('regular') }).toEqual({ inactive: [], regular: [] });
    expect(
      got.active
        .filter((g) => [chat, call, attempt].includes(g.key))
        .map((g) => `${g.table}:${g.type}`)
        .sort(),
    ).toEqual(['console_call_feed:INSERT', 'console_call_feed:UPDATE', 'console_calls:INSERT', 'console_calls:UPDATE', 'console_chat_messages:INSERT']);
  });

  it('control: once the inactive agent is activated, its same subscription receives the next change', async () => {
    await pool.query(`update public.console_agents set vox_active = true where user_id = $1`, [users.inactive.id]);
    const chat = (await pool.query(`insert into public.console_chat_messages (author_id, body) values ($1, $2) returning id`, [users.active.id, `${mark}-chat-2`]))
      .rows[0].id as string;
    chatIds.push(chat);
    expect(await waitFor(() => seen('inactive', 'console_chat_messages', chat) && seen('active', 'console_chat_messages', chat), 10_000)).toBe(true);
    await sleep(2000);
    expect(got.regular.filter((g) => g.key === chat)).toEqual([]);
  });
});
