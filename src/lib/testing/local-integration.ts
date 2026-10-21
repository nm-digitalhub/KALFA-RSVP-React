// Harness for the LOCAL-ONLY integration suite (vitest.integration.config.mts).
//
// Reuses, does not duplicate:
//   - target validation  → resolveLocalTestDb() in src/lib/outreach/test-db-guard.ts
//     (the existing resolveTestDb() prod guard + a loopback-only check on top);
//   - SSL choice         → testDbSsl() from the same module;
//   - the app's own clients: tests drive createAdminClient() by pointing
//     NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at the local stack.
//
// Adds what the project did not have (the existing integration tests isolate with
// ROLLBACK on their single pg connection, which cannot undo writes the code under
// test makes through PostgREST on other connections):
//   - installNetworkGuard(): socket-level + fetch-level egress block;
//   - FixtureScope: committed fixtures, ids registered BEFORE insertion, in-flight
//     work tracked, cleanup discovered from pg_constraint, residue verified on a
//     fresh query after COMMIT;
//   - dbFingerprint(): md5 of every row of every table, compared around the run.

import { randomUUID } from 'node:crypto';
import net from 'node:net';

import { Pool, type PoolClient } from 'pg';
import { vi } from 'vitest';

import { LOCAL_API_PORT, LOCAL_DB_PORT, resolveLocalTestDb, type TestDbConfig, testDbSsl } from '@/lib/outreach/test-db-guard';

export const IT_EMAIL_DOMAIN = 'kalfa.test';
export const IT_TAG_PREFIX = 'it-';
export const LOCAL_PORTS: readonly number[] = [LOCAL_DB_PORT, LOCAL_API_PORT];

export type LocalIntegrationEnv = TestDbConfig & { anonKey: string | null };

// Fail-fast entry point for every integration file: target is local AND the
// egress guard is active in this worker (i.e. the file runs under the
// integration config, not under the unit config with OUTREACH_DB_IT=1).
export function requireLocalIntegrationEnv(): LocalIntegrationEnv {
  const env = resolveLocalTestDb();
  if (!activeNetworkGuard()) {
    throw new Error(
      'REFUSING integration run: network guard is not installed — run through vitest.integration.config.mts (scripts/integration/run-local.sh)',
    );
  }
  return env;
}

// Point the application's createAdminClient() at the local stack for this file.
export function useLocalAdminEnv(env: LocalIntegrationEnv): void {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.supabaseUrl);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', env.serviceKey);
}

export function newPool(env: LocalIntegrationEnv, name: string, max = 4): Pool {
  return new Pool({ connectionString: env.dbUrl, ssl: testDbSsl(env.dbUrl), max, application_name: `kalfa-it-${name}` });
}

// ── network guard ─────────────────────────────────────────────────────────────
//
// Two layers, because the code under test reaches the network two ways:
//   - net.Socket.prototype.connect: every TCP/TLS client in Node goes through it —
//     the built-in fetch/undici and WebSocket, node:http/https, tls.connect, pg,
//     pg-boss. Disallowed targets are destroyed BEFORE DNS lookup or connect.
//   - globalThis.fetch: supabase-js and whatsapp-api-js (`ponyfill.fetch || fetch`)
//     call it; blocking here gives a URL-level record and a clear error.
// Allowed: loopback hosts on the given ports only. Unix-socket paths are refused.

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const GUARD_KEY = Symbol.for('kalfa.it.networkGuard');

export interface NetworkGuard {
  allowedPorts: readonly number[];
  blocked: string[];
  drain: () => string[];
  restore: () => void;
}

type ConnectTarget = { host: string; port: number | null; path: string | null };

function connectTarget(args: unknown[]): ConnectTarget {
  let a0 = args[0];
  if (Array.isArray(a0)) a0 = a0[0]; // net.connect() passes [normalizedOptions, cb]
  if (a0 && typeof a0 === 'object') {
    const o = a0 as { host?: string; port?: number | string; path?: string };
    if (o.path) return { host: '', port: null, path: String(o.path) };
    return { host: o.host ?? 'localhost', port: o.port == null ? null : Number(o.port), path: null };
  }
  if (typeof a0 === 'string' && Number.isNaN(Number(a0))) return { host: '', port: null, path: a0 };
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(a0), path: null };
}

export function activeNetworkGuard(): NetworkGuard | null {
  return ((globalThis as Record<symbol, unknown>)[GUARD_KEY] as NetworkGuard | undefined) ?? null;
}

export function installNetworkGuard(allowedPorts: readonly number[]): NetworkGuard {
  if (activeNetworkGuard()) throw new Error('network guard already installed');
  const blocked: string[] = [];
  const allowed = (host: string, port: number | null) => LOOPBACK.has(host) && port !== null && allowedPorts.includes(port);

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const t = connectTarget(args);
    if (!allowed(t.host, t.port)) {
      const what = t.path ? `unix:${t.path}` : `${t.host}:${t.port}`;
      blocked.push(`socket ${what}`);
      process.nextTick(() => this.destroy(new Error(`network guard: blocked connection to ${what}`)));
      return this;
    }
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    if (!allowed(u.hostname, port)) {
      blocked.push(`fetch ${u.origin}`);
      throw new Error(`network guard: blocked fetch to ${u.origin}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const guard: NetworkGuard = {
    allowedPorts,
    blocked,
    drain: () => blocked.splice(0, blocked.length),
    restore: () => {
      net.Socket.prototype.connect = originalConnect;
      globalThis.fetch = originalFetch;
      delete (globalThis as Record<symbol, unknown>)[GUARD_KEY];
    },
  };
  (globalThis as Record<symbol, unknown>)[GUARD_KEY] = guard;
  return guard;
}

// ── fixtures ───────────────────────────────────────────────────────────────────

export interface Fixture {
  tag: string;
  ownerId: string;
  eventId: string;
  campaignId: string;
  contactId: string;
  guestId: string;
  rsvpToken: string;
  phone: string;
  outboundWamid: string;
}

export interface FixtureOptions {
  authorized?: boolean; // add the contact to the campaign's authorized set
  campaignStatus?: 'active' | 'paused';
  expectedCount?: number | null;
}

export interface FixtureIds {
  owners: string[];
  events: string[];
  campaigns: string[];
  contacts: string[];
  guests: string[];
  tags: string[];
}

function newFixtureIds(): Fixture {
  const tag = `${IT_TAG_PREFIX}${randomUUID().slice(0, 8)}`;
  const digits = String(Number.parseInt(randomUUID().replace(/-/g, '').slice(0, 8), 16) % 10_000_000).padStart(7, '0');
  return {
    tag,
    ownerId: randomUUID(),
    eventId: randomUUID(),
    campaignId: randomUUID(),
    contactId: randomUUID(),
    guestId: randomUUID(),
    rsvpToken: '',
    phone: `+97259${digits}`,
    outboundWamid: `wamid.${tag}.out`,
  };
}

// Builds one event through the REAL lifecycle so every trigger fires (no
// session_replication_role): auth.users (→ profiles), events (forced draft → active),
// campaigns (draft → pending_approval → approved → active through the guard triggers).
async function insertFixture(pool: Pool, f: Fixture, opts: FixtureOptions): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `insert into auth.users (id, email, raw_user_meta_data, aud, role)
       values ($1, $2, '{"full_name":"IT owner"}', 'authenticated', 'authenticated')`,
      [f.ownerId, `${f.tag}@${IT_EMAIL_DOMAIN}`],
    );
    await c.query(
      `insert into public.events (id, name, owner_id, event_date, show_meal_pref)
       values ($1, $2, $3, now() + interval '30 days', true)`,
      [f.eventId, f.tag, f.ownerId],
    );
    await c.query(`update public.events set status = 'active' where id = $1`, [f.eventId]);
    await c.query(`insert into public.contacts (id, event_id, normalized_phone) values ($1, $2, $3)`, [f.contactId, f.eventId, f.phone]);
    const g = await c.query(
      `insert into public.guests (id, event_id, full_name, contact_id, expected_count)
       values ($1, $2, 'IT guest', $3, $4) returning rsvp_token`,
      [f.guestId, f.eventId, f.contactId, opts.expectedCount === undefined ? 4 : opts.expectedCount],
    );
    f.rsvpToken = g.rows[0].rsvp_token as string;
    await c.query(`insert into public.campaigns (id, event_id, max_contacts, status) values ($1, $2, 10, 'draft')`, [f.campaignId, f.eventId]);
    for (const s of ['pending_approval', 'approved', opts.campaignStatus ?? 'active']) {
      await c.query(`update public.campaigns set status = $2::public.campaign_status where id = $1`, [f.campaignId, s]);
    }
    if (opts.authorized !== false) {
      await c.query(
        `insert into public.campaign_authorized_contacts (campaign_id, contact_id, event_id) values ($1, $2, $3)`,
        [f.campaignId, f.contactId, f.eventId],
      );
    }
    // The outbound template message the guest will answer (resolveByContextId target).
    await c.query(
      `insert into public.contact_interactions (channel, direction, kind, provider_id, contact_id, event_id, campaign_id, guest_id)
       values ('whatsapp', 'out', 'template', $1, $2, $3, $4, $5)`,
      [f.outboundWamid, f.contactId, f.eventId, f.campaignId, f.guestId],
    );
    await c.query('commit');
  } catch (e) {
    // Undoes only this connection's own uncommitted inserts; the scope still runs
    // the full cleanup + residue check for these ids afterwards.
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// One scope per test file. Ids are registered before any insert, so a fixture that
// fails half-way, a failing/throwing test, or work still in flight when the test
// ends are all covered by cleanup().
export class FixtureScope {
  readonly fixtures: Fixture[] = [];
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly pool: Pool,
    private readonly onRegister?: (f: Fixture) => void,
  ) {}

  track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    const done = () => this.pending.delete(p);
    p.then(done, done);
    return p;
  }

  async create(opts: FixtureOptions = {}): Promise<Fixture> {
    const f = newFixtureIds();
    this.fixtures.push(f);
    this.onRegister?.(f);
    await this.track(insertFixture(this.pool, f, opts));
    return f;
  }

  // Inbox row as the webhook route would persist it (dedupe_key carries the tag).
  async insertInbox(
    f: Fixture,
    opts: { messageId: string; payload: Record<string, unknown>; contextId?: string | null },
  ): Promise<Record<string, unknown>> {
    const r = await this.track(
      this.pool.query(
        `insert into public.webhook_inbox (dedupe_key, event_kind, payload, message_id, context_message_id, phone_number_id)
         values ($1, 'message', $2::jsonb, $3, $4, null) returning *`,
        [`${f.tag}:${opts.messageId}`, JSON.stringify(opts.payload), opts.messageId, opts.contextId ?? null],
      ),
    );
    return r.rows[0];
  }

  ids(): FixtureIds {
    return idsOf(this.fixtures);
  }

  // Safe to call more than once and concurrently (deletes are idempotent and take
  // locks in one fixed order). Throws if anything is left behind.
  async cleanup(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
    await cleanupIds(this.pool, this.ids());
  }
}

export function idsOf(fixtures: Fixture[]): FixtureIds {
  return {
    owners: fixtures.map((f) => f.ownerId),
    events: fixtures.map((f) => f.eventId),
    campaigns: fixtures.map((f) => f.campaignId),
    contacts: fixtures.map((f) => f.contactId),
    guests: fixtures.map((f) => f.guestId),
    tags: fixtures.map((f) => f.tag),
  };
}

const uniq = (xs: string[]) => [...new Set(xs)];

// Adds anything the code under test created under the fixture owners/events.
async function expandIds(c: PoolClient, ids: FixtureIds): Promise<FixtureIds> {
  const ev = await c.query(`select id from public.events where id = any($1::uuid[]) or owner_id = any($2::uuid[])`, [ids.events, ids.owners]);
  const events = uniq([...ids.events, ...ev.rows.map((r) => r.id as string)]);
  const sub = await c.query(
    `select 'c' k, id from public.campaigns where event_id = any($1::uuid[])
     union all select 'k', id from public.contacts where event_id = any($1::uuid[])
     union all select 'g', id from public.guests where event_id = any($1::uuid[])`,
    [events],
  );
  const of = (k: string) => sub.rows.filter((r) => r.k === k).map((r) => r.id as string);
  return {
    ...ids,
    events,
    campaigns: uniq([...ids.campaigns, ...of('c')]),
    contacts: uniq([...ids.contacts, ...of('k')]),
    guests: uniq([...ids.guests, ...of('g')]),
  };
}

const ROOTS: Record<string, keyof FixtureIds> = {
  'public.events': 'events',
  'public.campaigns': 'campaigns',
  'public.contacts': 'contacts',
  'public.guests': 'guests',
};

// Single-column FKs that would BLOCK the cascade from auth.users (RESTRICT / NO ACTION)
// onto the fixture roots, read live from pg_constraint so a new table is covered
// without editing this file.
async function blockingReferrers(c: PoolClient): Promise<Array<{ table: string; column: string; root: keyof FixtureIds }>> {
  const r = await c.query(
    `select format('%I.%I', rn.nspname, rt.relname) as tbl, a.attname as col, fn.nspname || '.' || ft.relname as root
       from pg_constraint k
       join pg_class rt on rt.oid = k.conrelid join pg_namespace rn on rn.oid = rt.relnamespace
       join pg_class ft on ft.oid = k.confrelid join pg_namespace fn on fn.oid = ft.relnamespace
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f' and k.confdeltype in ('a', 'r') and cardinality(k.conkey) = 1
        and fn.nspname || '.' || ft.relname = any($1::text[])
        and rn.nspname || '.' || rt.relname <> all($1::text[])`,
    [Object.keys(ROOTS)],
  );
  return r.rows.map((x) => ({ table: x.tbl as string, column: x.col as string, root: ROOTS[x.root as string] }));
}

export async function cleanupIds(pool: Pool, given: FixtureIds): Promise<void> {
  const c = await pool.connect();
  let ids = given;
  try {
    await c.query('begin');
    ids = await expandIds(c, given);
    const refs = await blockingReferrers(c);
    // Referrers may reference each other; retry in passes until all succeed.
    let todo = refs;
    for (let pass = 0; todo.length > 0 && pass < 6; pass++) {
      const failed: typeof refs = [];
      for (const ref of todo) {
        await c.query('savepoint ref');
        try {
          await c.query(`delete from ${ref.table} where ${ref.column}::text = any($1::text[])`, [ids[ref.root]]);
          await c.query('release savepoint ref');
        } catch {
          await c.query('rollback to savepoint ref');
          failed.push(ref);
        }
      }
      if (failed.length === todo.length) break;
      todo = failed;
    }
    await c.query('delete from public.webhook_inbox where dedupe_key like any($1::text[])', [ids.tags.map((t) => `${t}:%`)]);
    // ON DELETE CASCADE from here: profiles, events → campaigns, contacts, guests,
    // interactions, rsvp_responses, activity_log, …
    await c.query('delete from auth.users where id = any($1::uuid[])', [ids.owners]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  // Proof is a NEW query after COMMIT, not a rollback.
  const left = await residue(pool, ids);
  if (left.length > 0) throw new Error(`integration cleanup left residue: ${left.join(', ')}`);
}

// Rows anywhere in public/auth that still point at the fixture ids: every column
// named event_id / campaign_id / contact_id / guest_id / owner_id / user_id, plus
// the roots themselves and the tagged inbox rows.
export async function residue(pool: Pool, ids: FixtureIds): Promise<string[]> {
  const r = await pool.query(
    `with cols as (
       select c.table_schema::text s, c.table_name::text t, c.column_name::text col,
              case c.column_name when 'event_id' then $1::text[] when 'campaign_id' then $2::text[]
                                 when 'contact_id' then $3::text[] when 'guest_id' then $4::text[] else $5::text[] end ids
         from information_schema.columns c
         join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
        where tb.table_type = 'BASE TABLE' and c.table_schema in ('public', 'auth')
          and c.column_name in ('event_id', 'campaign_id', 'contact_id', 'guest_id', 'owner_id', 'user_id')
       union all select 'public', 'events', 'id', $1::text[]
       union all select 'public', 'campaigns', 'id', $2::text[]
       union all select 'public', 'contacts', 'id', $3::text[]
       union all select 'public', 'guests', 'id', $4::text[]
       union all select 'public', 'profiles', 'id', $5::text[]
       union all select 'auth', 'users', 'id', $5::text[]
     )
     select s || '.' || t || '.' || col as where_, n
       from cols, lateral (
         select (xpath('/row/n/text()', query_to_xml(
           format('select count(*) n from %I.%I where %I::text = any(%L::text[])', s, t, col, ids), false, true, '')))[1]::text::int n
       ) x
      where n > 0
     union all
     select 'public.webhook_inbox.dedupe_key', count(*)::int from public.webhook_inbox
      where dedupe_key like any($6::text[]) having count(*) > 0`,
    [ids.events, ids.campaigns, ids.contacts, ids.guests, ids.owners, ids.tags.map((t) => `${t}:%`)],
  );
  return r.rows.map((x) => `${x.where_}=${x.n}`);
}

// Crash recovery: everything owned by an `it-…@kalfa.test` user, plus tagged inbox rows.
export async function sweepLeftovers(pool: Pool): Promise<number> {
  const o = await pool.query(`select id, split_part(email, '@', 1) tag from auth.users where email like $1`, [
    `${IT_TAG_PREFIX}%@${IT_EMAIL_DOMAIN}`,
  ]);
  const ids: FixtureIds = {
    owners: o.rows.map((r) => r.id as string),
    events: [],
    campaigns: [],
    contacts: [],
    guests: [],
    tags: o.rows.map((r) => r.tag as string),
  };
  await cleanupIds(pool, ids);
  await pool.query(`delete from public.webhook_inbox where dedupe_key like $1`, [`${IT_TAG_PREFIX}%:%`]);
  return ids.owners.length;
}

// ── whole-database fingerprint ─────────────────────────────────────────────────
// md5 over every row of every base table in public/auth/storage. Equal before and
// after a run ⇒ no residue and no mutation of rows the run did not own.
export async function dbFingerprint(pool: Pool): Promise<Map<string, string>> {
  const r = await pool.query(
    `select table_schema || '.' || table_name t,
            (xpath('/row/h/text()', query_to_xml(format(
              'select md5(coalesce(string_agg(md5(x::text), '','' order by md5(x::text)), '''')) h from %I.%I x',
              table_schema, table_name), false, true, '')))[1]::text h
       from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema in ('public', 'auth', 'storage')`,
  );
  return new Map(r.rows.map((x) => [x.t as string, x.h as string]));
}

export function fingerprintDiff(before: Map<string, string>, after: Map<string, string>): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((t) => before.get(t) !== after.get(t)).sort();
}
