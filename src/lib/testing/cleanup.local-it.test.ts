import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

import {
  activeNetworkGuard,
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
