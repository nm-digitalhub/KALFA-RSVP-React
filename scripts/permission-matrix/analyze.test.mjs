// Tests for scripts/permission-matrix/analyze.mjs and db.mjs, with node --test (npm run test:permission-matrix), like
// scripts/docs-scraper: vitest is set to src/**/*.test.{ts,tsx}.
//
// The analysis runs on a small TypeScript program built IN MEMORY from the fixtures below — the repo is never scanned
// and no database is opened. Each fixture is one case the scan must get right: the six from the review of 18.10.2026
// (listAllUsers, grantBillingCredit, setUserSuspended, the menu link to /admin/users, a read-only billing page, a
// service-role write with no gate) and the defects it named (a gate after the write, a nested function never called,
// a check whose answer guards nothing, a cut-off path), plus the cases the fix added (a gate in a try that swallows,
// a conditional gate, a client passed as a parameter, a check that guards through a variable).

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

import { analyze } from './analyze.mjs';
import { checkCli, parseRows } from './db.mjs';

const requireCjs = createRequire(import.meta.url);
const ts = requireCjs('typescript');

const ROOT = '/virtual';

const FILES = {
  'src/lib/supabase/client-type.ts': `
    export class QueryBuilder {
      select(_c?: string) { return this; }
      insert(_v: unknown) { return this; }
      update(_v: unknown) { return this; }
      upsert(_v: unknown) { return this; }
      delete() { return this; }
      eq(_c: string, _v: unknown) { return this; }
    }
    export class AuthAdmin {
      async getUserById(_id: string) { return {}; }
      async updateUserById(_id: string, _a: unknown) { return {}; }
    }
    export class SupabaseClient {
      from(_t: string) { return new QueryBuilder(); }
      async rpc(_f: string, _a?: unknown) { return {}; }
      auth = { admin: new AuthAdmin() };
    }`,
  'src/lib/supabase/admin.ts': `
    import { SupabaseClient } from './client-type';
    export function createAdminClient() { return new SupabaseClient(); }`,
  'src/lib/supabase/server.ts': `
    import { SupabaseClient } from './client-type';
    export async function createClient() { return new SupabaseClient(); }`,
  'src/lib/auth/dal.ts': `
    const cache = <T>(f: T): T => f;
    export const requireUser = cache(async () => ({ id: 'u' }));
    export const hasPlatformPermission = cache(async (_key: string): Promise<boolean> => true);
    export const isPlatformOwner = cache(async (): Promise<boolean> => true);
    export const requirePlatformPermission = cache(async (key: string) => {
      const user = await requireUser();
      if (!(await hasPlatformPermission(key))) throw new Error('denied');
      return user;
    });
    export const requirePlatformOwner = cache(async () => requireUser());
    export const requirePlatformStaff = cache(async () => requireUser());`,
  'src/lib/auth/console-agent.ts': `
    export async function requireConsoleAgent(_r: unknown) { return { ok: true as boolean }; }
    export async function callerHasPlatformPermission(_s: unknown, _k: string) { return true; }`,
  'src/lib/data/admin/users.ts': `
    import { requirePlatformPermission } from '@/lib/auth/dal';
    import { createAdminClient } from '@/lib/supabase/admin';
    export async function listAllUsers() {
      await requirePlatformPermission('manage_staff');
      const admin = createAdminClient();
      return admin.from('profiles').select('*');
    }
    export async function grantBillingCredit(userId: string) {
      await requirePlatformPermission('manage_staff');
      const admin = createAdminClient();
      await admin.from('billing_credits').insert({ userId });
    }
    export async function setUserSuspended(userId: string) {
      await requirePlatformPermission('manage_staff');
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(userId, {});
    }
    export async function writeThenGate(userId: string) {
      const admin = createAdminClient();
      await admin.from('profiles').update({ suspended: true }).eq('id', userId);
      await requirePlatformPermission('manage_staff');
    }
    export async function withUnusedNested() {
      await requirePlatformPermission('manage_staff');
      async function neverCalled() {
        const admin = createAdminClient();
        await admin.from('never_called').delete();
      }
      return 1;
    }
    export async function viaParam(client: ReturnType<typeof createAdminClient>) {
      await client.from('param_table').update({});
    }`,
  'src/lib/data/admin/deep.ts': `
    import { createAdminClient } from '@/lib/supabase/admin';
    export async function d1() { await d2(); }
    export async function d2() { await d3(); }
    export async function d3() { await d4(); }
    export async function d4() { await createAdminClient().from('deep_table').update({}); }`,
  'src/lib/data/admin/numbers.ts': `
    import { requirePlatformPermission } from '@/lib/auth/dal';
    import { createAdminClient } from '@/lib/supabase/admin';
    import { createClient } from '@/lib/supabase/server';
    // The shape of provider-numbers.ts requireRolePermission: one key per branch, every path checks one.
    async function requireRolePermission(role: string) {
      if (role === 'voice') {
        await requirePlatformPermission('manage_voice');
        return;
      }
      await requirePlatformPermission('manage_settings');
    }
    export async function assignRole(role: string) {
      await requireRolePermission(role);
      const supabase = await createClient();
      await supabase.from('number_roles').upsert({ role });
    }
    export async function ifElseGate(flag: boolean) {
      if (flag) await requirePlatformPermission('manage_voice');
      else await requirePlatformPermission('manage_settings');
      await createAdminClient().from('voice_or_settings').update({});
    }`,
  'src/lib/data/admin/campaign-close.ts': `
    import { requirePlatformPermission } from '@/lib/auth/dal';
    import { createAdminClient } from '@/lib/supabase/admin';
    export async function closeLike(id: string) {
      await requirePlatformPermission('campaigns.runstate');
      await createAdminClient().from('campaigns').update({ status: 'closed' }).eq('id', id);
    }
    export async function settingsOnly() {
      await requirePlatformPermission('manage_settings');
      return createAdminClient().from('app_settings').select('*');
    }`,
  'src/app/(admin)/admin/users/page.tsx': `
    import { requirePlatformPermission } from '@/lib/auth/dal';
    import { listAllUsers } from '@/lib/data/admin/users';
    export default async function UsersPage() {
      await requirePlatformPermission('manage_staff');
      await listAllUsers();
      return null;
    }`,
  'src/app/(admin)/admin/billing/page.tsx': `
    import { requirePlatformPermission } from '@/lib/auth/dal';
    import { createAdminClient } from '@/lib/supabase/admin';
    export default async function BillingPage() {
      await requirePlatformPermission('manage_billing');
      const admin = createAdminClient();
      await admin.from('campaigns').select('*');
      return null;
    }`,
  'src/app/(admin)/admin/users/actions.ts': `'use server';
    import { requirePlatformOwner, requirePlatformPermission } from '@/lib/auth/dal';
    import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
    import { createAdminClient } from '@/lib/supabase/admin';
    import { createClient } from '@/lib/supabase/server';
    import { grantBillingCredit, setUserSuspended, viaParam, withUnusedNested, writeThenGate } from '@/lib/data/admin/users';
    import { d1 } from '@/lib/data/admin/deep';
    import { assignRole, ifElseGate } from '@/lib/data/admin/numbers';
    import { closeLike, settingsOnly } from '@/lib/data/admin/campaign-close';
    import { hasPlatformPermission } from '@/lib/auth/dal';
    // The cancellation shape: behind manage_billing, then — on some paths — code that requires campaigns.runstate.
    export async function resolveLike(id: string, isPackage: boolean) {
      await requirePlatformPermission('manage_billing');
      await createAdminClient().from('refunds').insert({ id });
      if (isPackage) await closeLike(id);
    }
    // The voximplant-page shape: the other key's code runs only behind a check of that key.
    export async function guardedOtherKey() {
      await requirePlatformPermission('manage_voice');
      const canSettings = await hasPlatformPermission('manage_settings');
      const master = canSettings ? await settingsOnly() : null;
      return master;
    }
    export async function assignRoleAction(role: string) { await assignRole(role); }
    export async function ifElseAction(flag: boolean) { await ifElseGate(flag); }
    export async function grantCreditAction(id: string) { await grantBillingCredit(id); }
    export async function suspendAction(id: string) { await setUserSuspended(id); }
    export async function adminWriteNoGate(id: string) {
      const admin = createAdminClient();
      await admin.from('profiles').delete().eq('id', id);
    }
    export async function writeThenGateAction(id: string) { await writeThenGate(id); }
    export async function nestedAction() { await withUnusedNested(); }
    export async function consoleUnguarded() {
      await callerHasPlatformPermission(null, 'campaigns.runstate');
      await createAdminClient().from('campaigns').update({});
    }
    export async function consoleGuarded() {
      if (!(await callerHasPlatformPermission(null, 'campaigns.runstate'))) return;
      await createAdminClient().from('campaigns').update({ paused: true });
    }
    export async function guardViaVariable() {
      const auth = await requireConsoleAgent(null);
      if (!auth.ok) return;
      await createAdminClient().from('console_calls').insert({});
    }
    export async function paramAction() {
      await requirePlatformPermission('manage_billing');
      const admin = createAdminClient();
      await viaParam(admin);
    }
    export async function deepAction() { await d1(); }
    export async function tryGate() {
      try { await requirePlatformPermission('manage_staff'); } catch {}
      await createAdminClient().from('profiles').update({});
    }
    export async function tryGateExits() {
      try { await requirePlatformPermission('manage_staff'); } catch { return; }
      await createAdminClient().from('profiles').update({});
    }
    export async function rpcCheckedInDb() {
      const supabase = await createClient();
      await supabase.rpc('owner_only_report');
    }
    export async function voiceWritesSettings() {
      await requirePlatformPermission('manage_voice');
      const supabase = await createClient();
      await supabase.from('app_settings').update({ voice: true });
    }
    export async function ownerWritesSettings() {
      await requirePlatformOwner();
      const supabase = await createClient();
      await supabase.from('app_settings').update({ owner: true });
    }
    export async function viewKeyWrites() {
      await requirePlatformPermission('view_customer_data');
      const admin = createAdminClient();
      await admin.from('audit_log').insert({});
      await admin.from('leads').update({});
    }
    export async function conditionalGate(flag: boolean) {
      if (flag) await requirePlatformPermission('manage_staff');
      await createAdminClient().from('profiles').update({});
    }`,
  'src/app/(admin)/admin/owner-only/page.tsx': `
    import { requirePlatformOwner } from '@/lib/auth/dal';
    import { grantBillingCredit } from '@/lib/data/admin/users';
    export default async function OwnerOnlyPage() {
      await requirePlatformOwner();
      await grantBillingCredit('x');
      return null;
    }`,
  'src/components/admin-shell.tsx': `
    export const NAV = [
      { href: '/admin/users', label: 'משתמשים', permission: 'view_customer_data' },
      { href: '/admin/billing', label: 'חיוב', permission: 'manage_billing' },
    ];`,
};

const DB = {
  catalog: [
    { key: 'manage_staff', category: 'platform', roles: ['owner'] },
    { key: 'manage_billing', category: 'billing', roles: ['billing_clerk', 'owner'] },
    { key: 'view_billing', category: 'billing', roles: ['auditor', 'billing_clerk', 'owner'] },
    { key: 'view_customer_data', category: 'support', roles: ['support_agent', 'billing_clerk', 'owner'] },
    { key: 'campaigns.runstate', category: 'ops', roles: ['ops_engineer', 'owner'] },
  ],
  roles: [{ name: 'owner', is_owner_role: true }],
  rls: new Map([['app_settings', { rls: true }]]),
  policies: new Map([['app_settings', [{ name: 'app_settings_admin_all', permissive: 'PERMISSIVE', cmd: 'ALL', roles: '{authenticated}', keys: ['manage_settings'] }]]]),
  fns: new Map([['owner_only_report', { definer: true, volatility: 'v', keys: ['OWNER'] }]]),
};

const POLICY = {
  functions: {
    'src/lib/data/admin/users.ts#listAllUsers': 'view_customer_data',
    'src/lib/data/admin/users.ts#grantBillingCredit': 'manage_billing',
    'src/lib/data/admin/users.ts#setUserSuspended': 'manage_staff',
  },
};

function buildProgram(files) {
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    baseUrl: ROOT,
    paths: { '@/*': ['src/*'] },
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const virtual = new Map(Object.entries(files).map(([f, s]) => [path.posix.join(ROOT, f), s]));
  const real = { fileExists: host.fileExists, readFile: host.readFile, getSourceFile: host.getSourceFile, directoryExists: host.directoryExists };
  host.fileExists = (f) => virtual.has(f) || real.fileExists(f);
  host.readFile = (f) => virtual.get(f) ?? real.readFile(f);
  host.getSourceFile = (f, lang) => (virtual.has(f) ? ts.createSourceFile(f, virtual.get(f), lang, true) : real.getSourceFile(f, lang));
  host.directoryExists = (d) => [...virtual.keys()].some((k) => k.startsWith(`${d}/`)) || (real.directoryExists ? real.directoryExists(d) : false);
  host.getCurrentDirectory = () => ROOT;
  return ts.createProgram([...virtual.keys()], options, host);
}

const run = (opts = {}) => analyze({ ts, program: buildProgram(FILES), root: ROOT, db: DB, policy: POLICY, ...opts });
const result = run();
const find = (rule, entry, r = result) => r.findings.filter((f) => f.rule.startsWith(rule) && f.entry === entry);
const action = (name) => `/admin/users · action ${name}`;

describe('the six cases from the review', () => {
  it('listAllUsers behind manage_staff, where the policy says view_customer_data: MISMATCH', () => {
    const [f] = find('P2', 'src/lib/data/admin/users.ts#listAllUsers');
    assert.ok(f, 'expected a P2 finding');
    assert.equal(f.state, 'MISMATCH');
    assert.deepEqual(f.found, ['manage_staff']);
    assert.equal(f.expected, 'view_customer_data');
  });

  it('grantBillingCredit behind manage_staff, where the policy says manage_billing: MISMATCH', () => {
    const [f] = find('P2', 'src/lib/data/admin/users.ts#grantBillingCredit');
    assert.ok(f);
    assert.equal(f.expected, 'manage_billing');
  });

  it('setUserSuspended behind manage_staff, as the policy says: PROVEN', () => {
    const [f] = find('P1', 'src/lib/data/admin/users.ts#setUserSuspended');
    assert.ok(f);
    assert.equal(f.state, 'PROVEN');
  });

  it('the menu link to /admin/users under another key than the page proves: MISMATCH', () => {
    const [f] = find('M4', '/admin/users · page default (UsersPage)');
    assert.ok(f);
    assert.equal(f.state, 'MISMATCH');
    assert.deepEqual(f.found, ['view_customer_data']);
    assert.equal(f.expected, 'manage_staff');
  });

  it('a page that only reads, behind manage_billing while view_billing exists: REVIEW, as a candidate', () => {
    const [f] = find('V2', '/admin/billing · page default (BillingPage)');
    assert.ok(f);
    assert.equal(f.state, 'REVIEW');
    assert.equal(f.expected, 'view_billing');
    assert.match(f.text, /CANDIDATE/);
  });

  it('a service-role write with no gate: MISMATCH, critical', () => {
    const [f] = find('M1', action('adminWriteNoGate'));
    assert.ok(f);
    assert.equal(f.state, 'MISMATCH');
    assert.equal(f.severity, 'critical');
    assert.match(f.location, /actions\.ts:\d+$/);
  });
});

describe('the defects the review named', () => {
  it('a gate AFTER the write does not protect it', () => {
    const [f] = find('M1', action('writeThenGateAction'));
    assert.ok(f, 'the write before the gate must be reported');
    assert.match(f.text, /do NOT run before it/);
    assert.match(f.text, /manage_staff/);
    assert.ok(f.chain.some((step) => step.includes('writeThenGate')), 'the chain names the function');
  });

  it('a nested function that is never called is not scanned', () => {
    const nested = result.entries.find((e) => e.id === action('nestedAction'));
    assert.ok(nested);
    assert.ok(!result.entries.some((e) => e.ops.some((op) => op.target === 'never_called')));
  });

  it('a check whose answer guards nothing protects nothing', () => {
    const [f] = find('M1', action('consoleUnguarded'));
    assert.ok(f);
  });

  it('a check that guards an exit protects what follows it', () => {
    assert.equal(find('M1', action('consoleGuarded')).length, 0);
    const e = result.entries.find((x) => x.id === action('consoleGuarded'));
    assert.ok(e.ops.every((op) => op.proven.includes('campaigns.runstate')));
  });

  it('a path deeper than the limit is reported as cut off', () => {
    const shallow = run({ maxDepth: 2 });
    const [f] = find('U6', action('deepAction'), shallow);
    assert.ok(f);
    assert.equal(f.state, 'UNRESOLVED');
    assert.ok(shallow.coverage.truncatedPaths > 0);
  });
});

describe('what the fix added', () => {
  it('a gate inside a try whose catch swallows it may not enforce', () => {
    assert.ok(find('U4', action('tryGate'))[0]);
    assert.ok(find('M1', action('tryGate'))[0], 'and the write after it is not protected');
  });

  it('a gate inside an if does not protect what follows it', () => {
    const [f] = find('M1', action('conditionalGate'));
    assert.ok(f);
    assert.match(f.text, /manage_staff \(may/);
  });

  it('a client passed as a parameter keeps its source, and the caller\'s gate protects the callee', () => {
    const e = result.entries.find((x) => x.id === action('paramAction'));
    const op = e.ops.find((o) => o.target === 'param_table');
    assert.equal(op.origin, 'service');
    assert.ok(op.proven.includes('manage_billing'));
    assert.equal(find('M1', action('paramAction')).length, 0);
  });

  it('a check that guards through a variable counts, and a floor alone is REVIEW, not PROVEN', () => {
    const [f] = find('V1', action('guardViaVariable'));
    assert.ok(f);
    assert.deepEqual(f.found, ['CONSOLE_AGENT']);
  });

  it('a gate inside the callee protects the action that calls it', () => {
    assert.equal(find('M1', action('grantCreditAction')).length, 0);
    assert.equal(find('M1', action('suspendAction')).length, 0);
  });

  it('a gate in a try whose catch exits does enforce', () => {
    assert.equal(find('U4', action('tryGateExits')).length, 0);
    assert.equal(find('M1', action('tryGateExits')).length, 0);
  });

  it('an entry gated on OWNER is never refused deeper: the owner holds every key', () => {
    assert.equal(find('M2', '/admin/owner-only · page default (OwnerOnlyPage)').length, 0);
  });

  it('a write behind only a view key is REVIEW; an insert into an append-only table is not counted', () => {
    const list = find('V8', action('viewKeyWrites'));
    assert.equal(list.length, 1);
    assert.equal(list[0].state, 'REVIEW');
    assert.match(list[0].text, /leads\.update/);
    assert.ok(result.appendOnly.includes('audit_log'));
  });

  it('read-only candidates need the catalog: none without --db', () => {
    const noDb = run({ db: null, policy: null });
    assert.equal(noDb.findings.filter((f) => f.rule.startsWith('V2')).length, 0);
    assert.equal(noDb.readOnlyCandidatesChecked, false);
  });

  it('a helper that checks one key per branch protects the caller with any(…)', () => {
    const e = result.entries.find((x) => x.id === action('assignRoleAction'));
    const op = e.ops.find((o) => o.target === 'number_roles');
    assert.ok(op.proven.includes('any(manage_settings|manage_voice)'), op.proven.join(','));
    assert.equal(find('M1', action('assignRoleAction')).length, 0);
    assert.equal(find('V7', action('assignRoleAction')).length, 0);
  });

  it('an if / else with a different gate in each branch protects what follows', () => {
    const e = result.entries.find((x) => x.id === action('ifElseAction'));
    const op = e.ops.find((o) => o.target === 'voice_or_settings');
    assert.ok(op.proven.includes('any(manage_settings|manage_voice)'), op.proven.join(','));
    assert.equal(find('M1', action('ifElseAction')).length, 0);
  });

  it('an RPC whose database function checks a key is reported as protected there, not as unprotected', () => {
    const [f] = find('V9', action('rpcCheckedInDb'));
    assert.ok(f);
    assert.deepEqual(f.found, ['OWNER']);
    assert.equal(find('M1', action('rpcCheckedInDb')).length, 0);
  });

  it('code that checks one key on a table whose RLS checks another: REVIEW; the owner is never flagged', () => {
    const [f] = find('V6', action('voiceWritesSettings'));
    assert.ok(f, 'manage_voice against a manage_settings policy must be reported');
    assert.deepEqual(f.found, ['manage_voice']);
    assert.equal(f.expected, 'manage_settings');
    assert.equal(find('V6', action('ownerWritesSettings')).length, 0);
  });

  it('a different key on SOME paths, not chosen by a check of it, is a MISMATCH', () => {
    const [f] = find('M2b', action('resolveLike'));
    assert.ok(f, 'the cancellation shape must be reported');
    assert.equal(f.state, 'MISMATCH');
    assert.deepEqual(f.found, ['manage_billing']);
    assert.equal(f.expected, 'campaigns.runstate');
  });

  it('a different key on a path chosen by a check of that key is not reported', () => {
    assert.equal(find('M2b', action('guardedOtherKey')).length, 0);
  });

  it('a helper that picks its key by branch is not reported as a conflict', () => {
    assert.equal(find('M2b', action('assignRoleAction')).length, 0);
  });

  it('every finding has a state from the four', () => {
    for (const f of result.findings) assert.ok(['MISMATCH', 'UNRESOLVED', 'REVIEW', 'PROVEN'].includes(f.state), f.rule);
  });
});

describe('db.mjs', () => {
  it('reads the shapes the CLI may answer in', () => {
    assert.deepEqual(parseRows('[{"a":1}]'), [{ a: 1 }]);
    assert.deepEqual(parseRows('{"rows":[{"a":1}]}'), [{ a: 1 }]);
    assert.deepEqual(parseRows('{"data":[{"a":1}]}'), [{ a: 1 }]);
    assert.deepEqual(parseRows('{"a":1}\n{"a":2}'), [{ a: 1 }, { a: 2 }]);
    assert.deepEqual(parseRows(''), []);
  });

  it('refuses a shape it does not know, instead of guessing', () => {
    assert.throws(() => parseRows('{"message":"boom"}'), /shape/);
    assert.throws(() => parseRows('not json at all'), /shape/);
  });

  it('stops before any query when the CLI lacks the flags it uses', () => {
    assert.throws(() => checkCli('--linked only'), /--output-format/);
    assert.doesNotThrow(() => checkCli('--linked … --output-format choice'));
  });
});
