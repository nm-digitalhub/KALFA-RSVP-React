// harden-console-agent-permissions task 4.3: the console surface over the real Data API (local PostgREST
// 127.0.0.1:54321), as anon and as a regular signed-in user (local GoTrue). Agent personas stay at transaction level
// (design D6, decision 1.4): an agent needs platform_staff + console_agents rows that PostgREST can only see once
// committed, and those tables cascade from auth.users only through FixtureScope's user cleanup — the regular user here
// is the one committed persona, created and removed by FixtureScope.
//
// What it proves: the HTTP status and Postgres code each client gets, which a rolled-back SQL session cannot show
// (PostgREST maps 42501 to 401 for anon and 403 for authenticated; a filterless PATCH meets pg-safeupdate's 21000).
// Tokens and keys stay in memory and are never logged.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { type AuthUser, FixtureScope, newPool, requireLocalIntegrationEnv } from '@/lib/testing/local-integration';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV = RUN ? requireLocalIntegrationEnv() : null;

const VIEWS = [
  'console_events',
  'console_campaigns',
  'console_campaign_targets',
  'console_event_guests',
  'console_rsvp_results',
  'console_call_analysis',
  'console_me',
  'console_agents_roster',
] as const;
// Readable by authenticated (design D5 map); RLS returns no row to a non-agent.
const READABLE_TABLES = [
  'console_agents',
  'console_calls',
  'console_queues',
  'console_agent_queues',
  'console_agent_calendar_presence',
  'call_dispatch_status',
  'human_agent_call_legs',
  'console_agent_shift',
  'console_call_feed',
  'console_chat_messages',
  'agent_status',
] as const;
const SERVER_ONLY = ['console_call_pii', 'console_agent_commands', 'console_agent_secrets'] as const;

type Res = { status: number; code: string | null; rows: number | null };

async function rest(path: string, token: string | null, init: RequestInit = {}): Promise<Res> {
  const headers = new Headers(init.headers);
  headers.set('apikey', ENV!.anonKey!);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const r = await fetch(`${ENV!.supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const code = body && typeof body === 'object' && !Array.isArray(body) ? String((body as { code?: unknown }).code ?? '') || null : null;
  return { status: r.status, code, rows: Array.isArray(body) ? body.length : null };
}

describe.skipIf(!RUN)('console surface over local PostgREST (task 4.3)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let regular: AuthUser;

  beforeAll(async () => {
    if (!RUN) return;
    if (!ENV!.anonKey) throw new Error('console-rest: the local anon key is required');
    pool = newPool(ENV!, 'console-rest', 2);
    scope = new FixtureScope(pool);
    regular = await scope.createAuthUser(ENV!);
  });

  afterAll(async () => {
    if (!RUN) return;
    await scope?.cleanup();
    await pool?.end();
  });

  it('anon: every console view is refused (401 / 42501)', async () => {
    const out: Record<string, Res> = {};
    for (const v of VIEWS) out[v] = await rest(`${v}?select=*&limit=1`, null);
    expect(out).toEqual(Object.fromEntries(VIEWS.map((v) => [v, { status: 401, code: '42501', rows: null }])));
  });

  it('anon: the server-only tables are refused (401 / 42501)', async () => {
    const out: Record<string, Res> = {};
    for (const t of SERVER_ONLY) out[t] = await rest(`${t}?select=*&limit=1`, null);
    expect(out).toEqual(Object.fromEntries(SERVER_ONLY.map((t) => [t, { status: 401, code: '42501', rows: null }])));
  });

  it('regular user: 0 rows from every console view and every readable console table', async () => {
    const out: Record<string, Res> = {};
    for (const o of [...VIEWS, ...READABLE_TABLES]) out[o] = await rest(`${o}?select=*&limit=5`, regular.session.access_token);
    expect(out).toEqual(Object.fromEntries([...VIEWS, ...READABLE_TABLES].map((o) => [o, { status: 200, code: null, rows: 0 }])));
  });

  it('regular user: the server-only tables are refused (403 / 42501), console_agent_secrets included', async () => {
    const out: Record<string, Res> = {};
    for (const t of SERVER_ONLY) out[t] = await rest(`${t}?select=*&limit=1`, regular.session.access_token);
    expect(out).toEqual(Object.fromEntries(SERVER_ONLY.map((t) => [t, { status: 403, code: '42501', rows: null }])));
  });

  it('regular user: even the secrets table user_id column alone is refused (403 / 42501)', async () => {
    expect(await rest('console_agent_secrets?select=user_id&limit=1', regular.session.access_token)).toEqual({ status: 403, code: '42501', rows: null });
  });

  it('regular user: a filterless PATCH on console_agent_shift is refused before it runs (400 / 21000)', async () => {
    const r = await rest('console_agent_shift', regular.session.access_token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ active: false }),
    });
    expect(r).toEqual({ status: 400, code: '21000', rows: null });
  });

  it('regular user: the shift upsert the app sends inserts nothing (row-level security, 403 / 42501)', async () => {
    const r = await rest('console_agent_shift?on_conflict=agent_id', regular.session.access_token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ agent_id: regular.id, active: true, updated_at: new Date().toISOString() }),
    });
    expect(r).toEqual({ status: 403, code: '42501', rows: null });
  });
});
