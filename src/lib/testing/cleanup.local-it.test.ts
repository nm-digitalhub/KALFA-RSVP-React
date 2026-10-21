import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LOCAL_DB_PORT } from '@/lib/outreach/test-db-guard';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

import {
  activeNetworkGuard,
  cleanupIds,
  dbFingerprint,
  type Fixture,
  type FixtureIds,
  FixtureScope,
  fingerprintDiff,
  idsOf,
  newPool,
  requireLocalIntegrationEnv,
  residue,
  sweepLeftovers,
  useLocalAdminEnv,
} from './local-integration';

// Regression tests for the local integration harness itself:
//   A. fail-fast on non-local targets / missing guard — real child Vitest runs;
//   B. the egress guard installed by setupFiles is active in this worker;
//   C. cleanup after assertion failure, exception, concurrent tests with work in
//      flight, and SIGKILL (crash → sweep) — the probe runs in a CHILD process and
//      this file checks the database from outside, by id and by full fingerprint;
//   D. cleanup called concurrently / with in-flight work, in-process;
//   E. negative controls: residue() and fingerprintDiff() do detect leftovers.
// No proof here relies on ROLLBACK: every check is a fresh query after COMMIT.

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV = RUN ? requireLocalIntegrationEnv() : null;
const ROOT = path.resolve(__dirname, '../../..');
const VITEST = path.join(ROOT, 'node_modules/.bin/vitest');

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  ms: number;
}

function runVitest(
  args: string[],
  env: Record<string, string | undefined>,
  opts: { killWhen?: () => boolean; timeoutMs?: number } = {},
): Promise<ChildResult> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    // Same environment contract as scripts/integration/run-local.sh: production app
    // variables are removed. (This worker stubbed NEXT_PUBLIC_SUPABASE_URL to the local
    // API; passed on, resolveTestDb() in the child would rightly refuse the run.)
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_HOST']) delete childEnv[k];
    // Own process group, so a SIGKILL reaches the Vitest workers too.
    const child = spawn(VITEST, ['run', ...args], { cwd: ROOT, env: childEnv, detached: true });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    const timer = setInterval(() => {
      const late = Date.now() - t0 > (opts.timeoutMs ?? 120_000);
      if (late || opts.killWhen?.()) {
        clearInterval(timer);
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }, 100);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearInterval(timer);
      resolve({ code, signal, output, ms: Date.now() - t0 });
    });
  });
}

describe.skipIf(!RUN)('local integration harness — regression', () => {
  let pool: Pool;
  let tmp: string;

  beforeAll(() => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'harness', 6);
    tmp = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'kalfa-it-'));
  });
  afterAll(async () => {
    await sweepLeftovers(pool); // belt and braces; the assertions below expect 0 here
    await pool.end();
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── A. fail-fast ────────────────────────────────────────────────────────────
  describe('A. refuses non-local targets before touching anything', () => {
    const TARGET = ['--config', 'vitest.integration.config.mts', 'src/lib/data/webhook-message.local-it.test.ts'];
    it.each([
      ['a hosted DB', { OUTREACH_TEST_DB_URL: 'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres' }, /DB must be Supabase local/],
      ['a remote host on the local DB port', { OUTREACH_TEST_DB_URL: 'postgresql://postgres:x@10.255.255.1:54322/postgres' }, /DB must be Supabase local/],
      ['a hosted API', { OUTREACH_TEST_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }, /API must be/],
      ['the production ref', { OUTREACH_TEST_SUPABASE_URL: 'https://cklpaxihpyjbhymqtduv.supabase.co' }, /production/],
      ['no opt-in', { OUTREACH_DB_IT: '0' }, /OUTREACH_DB_IT=1/],
    ])('%s', async (_label, override, why) => {
      const before = await dbFingerprint(pool);
      const r = await runVitest(TARGET, override);
      expect(r.code).not.toBe(0);
      expect(r.output).toMatch(/REFUSING/);
      expect(r.output).toMatch(why);
      expect(r.output).not.toMatch(/Tests\s+\d+ passed/);
      expect(r.ms).toBeLessThan(30_000);
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    }, 60_000);

    it('an integration file run under the UNIT config (no network guard) refuses at load', async () => {
      const r = await runVitest(['--config', 'vitest.config.mts', 'src/lib/data/webhook-message.local-it.test.ts'], {});
      expect(r.code).not.toBe(0);
      expect(r.output).toMatch(/REFUSING integration run: network guard is not installed/);
    }, 60_000);
  });

  // ── B. guard wiring ─────────────────────────────────────────────────────────
  describe('B. the setupFiles guard is active in this worker', () => {
    it('allows only the local DB and API ports, and blocks a provider host', async () => {
      const g = activeNetworkGuard();
      expect(g?.allowedPorts).toEqual([54322, 54321]);
      expect((await fetch(`${ENV!.supabaseUrl}/rest/v1/`, { headers: { apikey: ENV!.serviceKey } })).ok).toBe(true);
      await expect(fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/me`)).rejects.toThrow(/network guard/);
      expect(g!.drain()).toEqual(['fetch https://graph.facebook.com']);
    });
  });

  // ── C. cleanup when the test ends badly (child process) ─────────────────────
  const readManifest = (file: string) =>
    existsSync(file)
      ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
      : [];
  const fixturesIn = (m: Record<string, unknown>[]) => m.filter((x) => x.fixture).map((x) => x.fixture as Fixture);
  const probe = (mode: string, killWhen?: (manifest: string) => boolean) => {
    const manifest = path.join(tmp, `${mode}-${randomUUID().slice(0, 6)}.jsonl`);
    return runVitest(['--config', 'vitest.integration.config.mts'], { KALFA_IT_PROBE: mode, KALFA_IT_PROBE_MANIFEST: manifest }, {
      killWhen: killWhen && (() => killWhen(manifest)),
    }).then((r) => ({ ...r, manifest: readManifest(manifest) }));
  };

  describe('C. cleanup after failure, exception, concurrency and crash', () => {
    it.each([
      ['an assertion failure', 'fail', 1],
      ['exceptions (thrown in the test; fixture creation failing half-way)', 'throw', 2],
      ['concurrent tests, one failing with real work still in flight', 'concurrent', 4],
    ])('%s leaves no row behind', async (_label, mode, fixtures) => {
      const before = await dbFingerprint(pool);
      const r = await probe(mode);
      expect(r.code, r.output).not.toBe(0); // the probe tests did fail
      const ids = idsOf(fixturesIn(r.manifest));
      expect(ids.owners).toHaveLength(fixtures);
      // The probe really wrote and billed through the code under test (not vacuous).
      const wrote = r.manifest.filter((x) => x.wrote);
      expect(wrote.length).toBeGreaterThan(0);
      expect(wrote.every((x) => (x.billed as number) === 1)).toBe(true);
      expect(r.manifest.some((x) => x.cleaned)).toBe(true);
      expect(await residue(pool, ids)).toEqual([]);
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    }, 120_000);

    it('SIGKILL mid-test: rows remain (no hook ran), the start-of-run sweep removes them', async () => {
      const before = await dbFingerprint(pool);
      const r = await probe('hang', (m) => readManifest(m).some((x) => x.ready));
      expect(r.signal).toBe('SIGKILL');
      expect(r.manifest.some((x) => x.cleaned)).toBe(false);
      const ids = idsOf(fixturesIn(r.manifest));
      expect(ids.owners).toHaveLength(1);
      const left = await residue(pool, ids);
      expect(left.length).toBeGreaterThan(0); // proves the kill really skipped cleanup
      expect(left.join(' ')).toMatch(/billed_results/);
      expect(await sweepLeftovers(pool)).toBe(1);
      expect(await residue(pool, ids)).toEqual([]);
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    }, 120_000);
  });

  // ── D. cleanup under concurrency, in-process ────────────────────────────────
  type Row = Parameters<typeof import('@/lib/data/webhook-processing').processWebhookEvent>[0];
  const reply = async (scope: FixtureScope, f: Fixture) =>
    (await scope.insertInbox(f, {
      messageId: `wamid.${f.tag}.${randomUUID().slice(0, 6)}`,
      payload: { type: 'button', from: f.phone.replace('+', ''), button: { payload: 'rsvp_declined', text: 'x' } },
      contextId: f.outboundWamid,
    })) as Row;

  describe('D. cleanup itself under concurrency', () => {
    it('three concurrent cleanup() calls after concurrent processing all succeed, nothing left', async () => {
      const before = await dbFingerprint(pool);
      const wp = await import('@/lib/data/webhook-processing');
      const scope = new FixtureScope(pool);
      const fx = await Promise.all([scope.create(), scope.create(), scope.create()]);
      const rows = await Promise.all(fx.map((f) => reply(scope, f)));
      await Promise.all(rows.flatMap((row) => [1, 2].map(() => scope.track(wp.processWebhookEvent(row, wp.createWebhookBatchContext())))));
      const billed = await pool.query(`select count(*)::int n from public.billed_results where event_id = any($1::uuid[])`, [scope.ids().events]);
      expect(billed.rows[0].n).toBe(3);
      await Promise.all([scope.cleanup(), scope.cleanup(), scope.cleanup()]);
      expect(await residue(pool, scope.ids())).toEqual([]);
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });

    it('cleanup() waits for tracked work still in flight', async () => {
      const before = await dbFingerprint(pool);
      const wp = await import('@/lib/data/webhook-processing');
      const scope = new FixtureScope(pool);
      const f = await scope.create();
      const row = await reply(scope, f);
      let settled = false;
      void scope.track(wp.processWebhookEvent(row, wp.createWebhookBatchContext())).finally(() => (settled = true));
      await scope.cleanup();
      expect(settled).toBe(true);
      expect(await residue(pool, scope.ids())).toEqual([]);
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });
  });

  // ── E. negative controls ────────────────────────────────────────────────────
  describe('E2. GoTrue users and staff roles', () => {
    it('a local-Auth user with a staff role leaves no row behind — incl. GoTrue and trigger audit rows', async () => {
      const before = await dbFingerprint(pool);
      const scope = new FixtureScope(pool);
      const u = await scope.createAuthUser(ENV!, { staffRole: 'auditor' });
      const audit = await pool.query(
        `select (select count(*)::int from auth.audit_log_entries where payload->'traits'->>'user_id' = $1 or payload->>'actor_id' = $1) gotrue,
                (select count(*)::int from public.platform_role_audit_log where target_user_id = $1::uuid) staff_audit`,
        [u.id],
      );
      expect(audit.rows[0].gotrue).toBeGreaterThan(0); // not vacuous: the audit rows exist
      expect(audit.rows[0].staff_audit).toBeGreaterThan(0);
      await scope.cleanup();
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });
  });

  // ── F. stage-9 review (diff.md): packages, failure reporting, audit isolation ──
  const insertPkg = (id: string, name: string) =>
    pool.query(`insert into public.packages (id, name, tier, price_with_vat, active) values ($1, $2, 'it', 1, false)`, [id, name]);
  // A package referenced three ways: campaigns.template_id and events.package_id
  // (NO ACTION) and offer_packages.package_id (RESTRICT, via an offer the fixture
  // owner created — offers.created_by → auth.users NO ACTION).
  const linkPkg = async (f: Fixture, pkgId: string, offerId: string) => {
    await pool.query(`update public.campaigns set template_id = $2 where id = $1`, [f.campaignId, pkgId]);
    await pool.query(`update public.events set package_id = $2 where id = $1`, [f.eventId, pkgId]);
    await pool.query(
      `insert into public.offers (id, title, kind, value, validity_days, created_by) values ($1, $2, 'amount', 1, 1, $3)`,
      [offerId, f.tag, f.ownerId],
    );
    await pool.query(`insert into public.offer_packages (offer_id, package_id) values ($1, $2)`, [offerId, pkgId]);
  };
  const pkgRefs = async (pkgId: string, offerId: string) =>
    (
      await pool.query(
        `select (select count(*)::int from public.packages where id = $1) pkg,
                (select count(*)::int from public.campaigns where template_id = $1) campaigns,
                (select count(*)::int from public.events where package_id = $1) events,
                (select count(*)::int from public.offer_packages where package_id = $1) offer_pkgs,
                (select count(*)::int from public.offers where id = $2) offers`,
        [pkgId, offerId],
      )
    ).rows[0] as Record<string, number>;
  const NONE = { pkg: 0, campaigns: 0, events: 0, offer_pkgs: 0, offers: 0 };

  describe('F1. crash recovery for a test package (SIGKILL before cleanup)', () => {
    // The child is a plain Node process with `pg` that writes like a test would
    // (every statement autocommits), prints READY and hangs until SIGKILL. It gets
    // the already-validated local DB URL only (no API keys) and re-checks the target
    // itself. The sweep is NOT given any id: it must find everything by convention.
    const CHILD = String.raw`
      const { Client } = require(process.env.KALFA_PG);
      const u = new URL(process.env.KALFA_DB_URL);
      if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== process.env.KALFA_DB_PORT) process.exit(9);
      const x = JSON.parse(process.env.KALFA_IDS);
      (async () => {
        const c = new Client({ connectionString: process.env.KALFA_DB_URL, application_name: 'kalfa-it-crash-child' });
        await c.connect();
        await c.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [x.owner, x.tag + '@kalfa.test']);
        await c.query("insert into public.packages (id, name, tier, price_with_vat, active) values ($1, $2, 'it', 1, false)", [x.pkg, x.tag + ' crash']);
        await c.query("insert into public.events (id, name, owner_id, event_date) values ($1, $2, $3, now() + interval '30 days')", [x.event, x.tag, x.owner]);
        await c.query("update public.events set status = 'active', package_id = $2 where id = $1", [x.event, x.pkg]);
        await c.query("insert into public.campaigns (id, event_id, max_contacts, status, template_id) values ($1, $2, 10, 'draft', $3)", [x.campaign, x.event, x.pkg]);
        await c.query("insert into public.offers (id, title, kind, value, validity_days, created_by) values ($1, $2, 'amount', 1, 1, $3)", [x.offer, x.tag, x.owner]);
        await c.query('insert into public.offer_packages (offer_id, package_id) values ($1, $2)', [x.offer, x.pkg]);
        process.stdout.write('READY\n');
        setInterval(() => {}, 1000);
      })().catch((e) => { process.stderr.write('child failed: ' + e.message + '\n'); process.exit(3); });
    `;

    it('the child is killed with its package linked to a campaign; sweepLeftovers removes the package and every dependent row', async () => {
      const before = await dbFingerprint(pool);
      // Near-miss packages that only half-match the convention: the sweep must leave them.
      const keep = [randomUUID(), randomUUID(), randomUUID()];
      const keepHash = () =>
        pool
          .query(`select string_agg(md5(t::text), ',' order by t.id) h, count(*)::int n from public.packages t where id = any($1::uuid[])`, [keep])
          .then((r) => r.rows[0]);
      await pool.query(
        `insert into public.packages (id, name, tier, price_with_vat, active) values
           ($1, 'Real package', 'it', 1, false), ($2, 'it-0123abcd real', 'test', 1, false), ($3, 'it-notahex x', 'it', 1, false)`,
        keep,
      );
      const kept = await keepHash();
      expect(kept.n).toBe(3);
      try {
        await crashAndSweep();
        expect(await keepHash()).toEqual(kept);
      } finally {
        await pool.query(`delete from public.packages where id = any($1::uuid[])`, [keep]);
      }
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    }, 60_000);

    const crashAndSweep = async () => {
      const x = {
        tag: `it-${randomUUID().slice(0, 8)}`,
        owner: randomUUID(), pkg: randomUUID(), event: randomUUID(), campaign: randomUUID(), offer: randomUUID(),
      };
      const childEnv: NodeJS.ProcessEnv = {
        NODE_ENV: 'test', PATH: process.env.PATH, KALFA_PG: path.join(ROOT, 'node_modules/pg'), KALFA_DB_URL: ENV!.dbUrl,
        KALFA_DB_PORT: String(LOCAL_DB_PORT), KALFA_IDS: JSON.stringify(x),
      };
      const child = spawn(process.execPath, ['-e', CHILD], { cwd: ROOT, env: childEnv });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d));
      child.stderr.on('data', (d: Buffer) => (out += d));
      const exit = new Promise<NodeJS.Signals | number | null>((res) => child.on('close', (code, sig) => res(sig ?? code)));
      for (let t = 0; !out.includes('READY') && t < 300 && child.exitCode === null; t++) await new Promise((r) => setTimeout(r, 100));
      expect(out).toContain('READY');
      child.kill('SIGKILL');
      expect(await exit).toBe('SIGKILL');

      // Not vacuous: the crash left the package and all three referrers behind.
      expect(await pkgRefs(x.pkg, x.offer)).toEqual({ pkg: 1, campaigns: 1, events: 1, offer_pkgs: 1, offers: 1 });
      expect(await sweepLeftovers(pool)).toBeGreaterThanOrEqual(1);
      expect(await pkgRefs(x.pkg, x.offer)).toEqual(NONE);
      const gone = await pool.query(
        `select (select count(*)::int from auth.users where id = $1) + (select count(*)::int from public.events where id = $2)
              + (select count(*)::int from public.campaigns where id = $3) n`,
        [x.owner, x.event, x.campaign],
      );
      expect(gone.rows[0].n).toBe(0);
    };
  });

  describe('F2. a test package linked to a campaign: delete order against the FKs', () => {
    it('the FKs really block a package-first delete; cleanup() orders it after its referrers and leaves nothing', async () => {
      const before = await dbFingerprint(pool);
      const scope = new FixtureScope(pool);
      const f = await scope.create();
      const pkgId = randomUUID();
      const offerId = randomUUID();
      scope.ownRow({ table: 'public.packages', id: pkgId });
      await insertPkg(pkgId, `${f.tag} linked`);
      await linkPkg(f, pkgId, offerId);
      expect(await pkgRefs(pkgId, offerId)).toEqual({ pkg: 1, campaigns: 1, events: 1, offer_pkgs: 1, offers: 1 });
      // Control: package first is refused by the database (a failed statement; nothing to undo).
      await expect(pool.query(`delete from public.packages where id = $1`, [pkgId])).rejects.toMatchObject({ code: '23503' });
      await scope.cleanup();
      expect(await pkgRefs(pkgId, offerId)).toEqual(NONE);
      expect(await residue(pool, scope.ids())).toEqual([]);
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });
  });

  describe('F3. a cleanup failure is reported, never swallowed', () => {
    it('a referrer that cannot be deleted (row locked elsewhere) fails cleanup with the table, the SQLSTATE and the rows left — and the fixture stays whole', async () => {
      const before = await dbFingerprint(pool);
      const scope = new FixtureScope(pool);
      const f = await scope.create();
      const { recordReached } = await import('@/lib/data/billing');
      // A real RESTRICT referrer row (billed_results → contacts / campaigns), written by the real RPC.
      await scope.track(
        recordReached({
          eventId: f.eventId, campaignId: f.campaignId, contactId: f.contactId, channel: 'whatsapp',
          attemptId: `it-${f.tag}`, evidence: 'whatsapp_inbound_message', providerRef: `it-${f.tag}`,
        }),
      );
      expect((await pool.query(`select count(*)::int n from public.billed_results where event_id = $1`, [f.eventId])).rows[0].n).toBe(1);
      const locker = await pool.connect();
      let err: unknown;
      try {
        await locker.query('begin');
        await locker.query(`select 1 from public.billed_results where event_id = $1 for update`, [f.eventId]);
        await cleanupIds(pool, scope.ids(), { lockTimeoutMs: 300 }).catch((e) => (err = e));
      } finally {
        await locker.query('rollback'); // releases the probe's lock only
        locker.release();
      }
      const msg = (err as Error | undefined)?.message ?? '';
      expect(msg).toMatch(/public\.billed_results\.\w+/);
      expect(msg).toMatch(/55P03/);
      expect(msg).toMatch(/1 row\(s\) left/);
      // Atomic: nothing of the fixture was half-deleted.
      expect(await residue(pool, scope.ids())).toEqual(expect.arrayContaining(['public.events.id=1', 'auth.users.id=1']));
      await scope.cleanup();
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });

    it("a package still referenced by a row the scope does not own is NOT deleted: cleanup fails naming the step and the constraint, the other scope's row survives", async () => {
      const before = await dbFingerprint(pool);
      const mine = new FixtureScope(pool);
      const other = new FixtureScope(pool);
      const f = await mine.create();
      const g = await other.create();
      const pkgId = randomUUID();
      mine.ownRow({ table: 'public.packages', id: pkgId });
      await insertPkg(pkgId, `${f.tag} shared`);
      await pool.query(`update public.events set package_id = $2 where id = $1`, [g.eventId, pkgId]);
      const err = await mine.cleanup().then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(/public\.packages/);
      expect(err?.message).toMatch(/23503/);
      expect(err?.message).toMatch(/events_package_id_fkey/);
      expect((await pool.query(`select count(*)::int n from public.events where id = $1 and package_id = $2`, [g.eventId, pkgId])).rows[0].n).toBe(1);
      await other.cleanup();
      await mine.cleanup();
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });
  });

  describe('F4. audit cleanup touches only rows of test entities', () => {
    it('sentinel audit rows of non-test actors (incl. the nil-uuid admin and near-miss package names) survive cleanup() and sweepLeftovers() byte for byte', async () => {
      const before = await dbFingerprint(pool);
      const realId = randomUUID();
      const realEmail = `sentinel-${realId.slice(0, 8)}@example.invalid`;
      const NIL = '00000000-0000-0000-0000-000000000000';
      const s = { gotrue: [randomUUID(), randomUUID()], staff: randomUUID(), activity: [randomUUID(), randomUUID(), randomUUID()] };
      const md5 = async () =>
        (
          await pool.query(
            `select (select string_agg(md5(t::text), ',' order by t.id) from auth.audit_log_entries t where id = any($1::uuid[])) g,
                    (select md5(t::text) from public.platform_role_audit_log t where id = $2) p,
                    (select string_agg(md5(t::text), ',' order by t.id) from public.activity_log t where id = any($3::uuid[])) a,
                    (select count(*)::int from auth.audit_log_entries where id = any($1::uuid[]))
                  + (select count(*)::int from public.platform_role_audit_log where id = $2)
                  + (select count(*)::int from public.activity_log where id = any($3::uuid[])) n`,
            [s.gotrue, s.staff, s.activity],
          )
        ).rows[0];
      // Pre-existing (non-test) GoTrue rows: the 4 the local DB had before the suite.
      const foreignGoTrue = () =>
        pool
          .query(
            `select coalesce(string_agg(md5(t::text), ',' order by t.id), '') h from auth.audit_log_entries t
              where id <> all($1::uuid[]) and coalesce(payload->'traits'->>'user_email', payload->>'actor_username', '') not like 'it-%@kalfa.test'`,
            [s.gotrue],
          )
          .then((r) => r.rows[0].h as string);
      const foreignBefore = await foreignGoTrue();
      try {
        await pool.query(
          `insert into auth.audit_log_entries (instance_id, id, payload, created_at, ip_address) values
             ($1, $2, jsonb_build_object('action', 'login', 'actor_id', $4::text, 'actor_username', $5::text), now(), ''),
             ($1, $3, jsonb_build_object('action', 'user_signedup', 'actor_id', $1::text, 'traits', jsonb_build_object('user_id', $4::text, 'user_email', $5::text)), now(), '')`,
          [NIL, s.gotrue[0], s.gotrue[1], realId, realEmail],
        );
        await pool.query(
          `insert into public.platform_role_audit_log (id, actor_id, action, target_user_id, details) values ($1, $2, 'sentinel', $3, '{}')`,
          [s.staff, realId, realId],
        );
        await pool.query(
          `insert into public.activity_log (id, user_id, event_id, action, meta) values
             ($1, null, null, 'package.deleted', '{"packageName":"Real package"}'),
             ($2, null, null, 'package.deleted', '{"packageName":"it-notatag x"}'),
             ($3, null, null, 'package.updated', '{"packageName":"it-0123abcdX y"}')`,
          s.activity,
        );
        const sentinels = await md5();
        expect(sentinels.n).toBe(6);

        // Test entities that DO produce audit rows: a GoTrue user with a staff role
        // (GoTrue signup + login, platform_role_audit_log trigger) and a fixture owner.
        const scope = new FixtureScope(pool);
        const u = await scope.createAuthUser(ENV!, { staffRole: 'auditor' });
        await scope.create();
        const testAudit = async () =>
          (
            await pool.query(
              `select (select count(*)::int from auth.audit_log_entries where payload->>'actor_id' = $1 or payload->'traits'->>'user_id' = $1)
                    + (select count(*)::int from public.platform_role_audit_log where actor_id = $1::uuid or target_user_id = $1::uuid) n`,
              [u.id],
            )
          ).rows[0].n as number;
        expect(await testAudit()).toBeGreaterThan(0);
        await scope.cleanup();
        await sweepLeftovers(pool);
        expect(await testAudit()).toBe(0);
        expect(await md5()).toEqual(sentinels); // untouched, byte for byte
        expect(await foreignGoTrue()).toBe(foreignBefore);
      } finally {
        await pool.query(`delete from auth.audit_log_entries where id = any($1::uuid[])`, [s.gotrue]);
        await pool.query(`delete from public.platform_role_audit_log where id = $1`, [s.staff]);
        await pool.query(`delete from public.activity_log where id = any($1::uuid[])`, [s.activity]);
      }
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });
  });

  describe('E. the detectors are not vacuous', () => {
    it('residue() reports a live fixture and fingerprintDiff() reports the tables it touched', async () => {
      const before = await dbFingerprint(pool);
      const scope = new FixtureScope(pool);
      await scope.create();
      const ids: FixtureIds = scope.ids();
      const left = await residue(pool, ids);
      expect(left).toEqual(expect.arrayContaining([expect.stringMatching(/^public\.events\.id=1$/), expect.stringMatching(/^auth\.users\.id=1$/)]));
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual(
        expect.arrayContaining(['auth.users', 'public.events', 'public.guests', 'public.campaigns']),
      );
      await scope.cleanup();
      expect(fingerprintDiff(before, await dbFingerprint(pool))).toEqual([]);
    });
  });
});
