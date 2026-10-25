import { describe, expect, it } from 'vitest';

import { PLATFORM_ACTIONS } from '@/lib/casl';

import {
  STAFF_TABLE_PERMISSIONS,
  operationKeys,
  type StaffTableRule,
  type TableOperation,
} from './staff-table-permissions';
import {
  ANON_SELECT,
  BEGIN_MARK,
  END_MARK,
  KEEP_POLICIES,
  actorsFor,
  canOverwriteTestFile,
  grantedOps,
  mergeIntoMigration,
  policyName,
  renderMigrationBody,
  renderPgTapFile,
  renderPgTapTests,
  type RowFixture,
  type Rules,
} from './staff-table-rls';

const OPS: readonly TableOperation[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const ALL = Object.keys(STAFF_TABLE_PERMISSIONS);
const CLOSED = ALL.filter((t) => STAFF_TABLE_PERMISSIONS[t as keyof typeof STAFF_TABLE_PERMISSIONS].group === 'closed');
const KEYED = ALL.filter((t) => !CLOSED.includes(t));

// Stand-ins for the catalogue the CLI reads from the local database: one old staff policy per table, plus the kept ones.
const EXISTING: Record<string, string[]> = Object.fromEntries(
  ALL.map((t) => [t, [`${t}_admin_all`, ...(KEEP_POLICIES[t] ?? [])]]),
);
const COLUMNS: Record<string, string> = Object.fromEntries(ALL.map((t) => [t, 'created_at']));
const FIXTURES: Record<string, RowFixture> = Object.fromEntries(
  KEYED.map((t) => [
    t,
    {
      seed: `insert into public.${t} (id) values ('fx-${t}')`,
      row: `id = 'fx-${t}'`,
      probe: 'id',
      probeValue: `fx-${t}`,
      insert: `(id) values ('new-${t}')`,
      insertValue: `new-${t}`,
      update: 'created_at = created_at',
    },
  ]),
);

// What the rendered migration says, read back from its text: policy -> [table, op, keys], grants per role.
function readMigration(sql: string) {
  const policies = [
    ...sql.matchAll(/create policy "(\w+)" on public\."(\w+)" for (\w+) to authenticated\n((?: {2}.*\n?)+)/g),
  ].map((m) => ({
    name: m[1],
    table: m[2],
    op: m[3].toUpperCase() as TableOperation,
    keys: [...new Set([...m[4].matchAll(/has_platform_permission\('([a-z_.]+)'\)/g)].map((k) => k[1]))].sort(),
    using: m[4].includes('using ('),
    check: m[4].includes('with check ('),
  }));
  const grants = [...sql.matchAll(/^grant (.+) on table public\."(\w+)" to (\w+);$/gm)].map((m) => ({
    ops: m[1].split(', ').map((o) => o.toUpperCase()).sort(),
    table: m[2],
    role: m[3],
  }));
  const drops = [...sql.matchAll(/^drop policy "(\w+)" on public\."(\w+)";$/gm)].map((m) => ({ name: m[1], table: m[2] }));
  const revokes = [...sql.matchAll(/^revoke all on table public\."(\w+)" from anon, authenticated;$/gm)].map((m) => m[1]);
  return { policies, grants, drops, revokes };
}

const mapKeys = (rule: StaffTableRule, op: TableOperation) => [...operationKeys(rule, op)].sort();

describe('renderMigrationBody: the 11 closed tables', () => {
  const sql = renderMigrationBody(CLOSED, EXISTING);
  const m = readMigration(sql);

  it('revokes every client privilege and drops every staff policy, grants nothing, creates no policy', () => {
    expect(m.revokes.sort()).toEqual([...CLOSED].sort());
    expect(m.drops.map((d) => d.table).sort()).toEqual([...CLOSED].sort());
    expect(m.grants).toEqual([]);
    expect(m.policies).toEqual([]);
  });
});

describe('renderMigrationBody: the 14 per-permission tables', () => {
  const sql = renderMigrationBody(KEYED, EXISTING);
  const m = readMigration(sql);

  for (const table of KEYED) {
    const rule: StaffTableRule = STAFF_TABLE_PERMISSIONS[table as keyof typeof STAFF_TABLE_PERMISSIONS];

    it(`${table}: one policy per granted operation, naming exactly the map's keys`, () => {
      const rendered = m.policies.filter((p) => p.table === table);
      expect(rendered.map((p) => p.op).sort()).toEqual(grantedOps(rule).sort());
      for (const p of rendered) {
        expect(p.keys, `${table} ${p.op}`).toEqual(mapKeys(rule, p.op));
        expect(p.name).toBe(policyName(table, p.op));
        // The RLS guide: UPDATE needs USING and WITH CHECK; INSERT only WITH CHECK; SELECT and DELETE only USING.
        expect([p.using, p.check], `${table} ${p.op} clauses`).toEqual(
          p.op === 'UPDATE' ? [true, true] : p.op === 'INSERT' ? [false, true] : [true, false],
        );
      }
    });

    it(`${table}: authenticated is granted exactly those operations; anon only the public read`, () => {
      const auth = m.grants.filter((g) => g.table === table && g.role === 'authenticated');
      expect(auth).toHaveLength(1);
      expect(auth[0].ops).toEqual(grantedOps(rule).sort());
      const anon = m.grants.filter((g) => g.table === table && g.role === 'anon');
      expect(anon.map((g) => g.ops)).toEqual(ANON_SELECT.includes(table) ? [['SELECT']] : []);
    });

    it(`${table}: drops the old policies and keeps only the listed reads`, () => {
      const dropped = m.drops.filter((d) => d.table === table).map((d) => d.name);
      expect(dropped).toEqual([`${table}_admin_all`]);
      for (const kept of KEEP_POLICIES[table] ?? []) expect(dropped).not.toContain(kept);
    });
  }

  it('packages takes each operation key from PLATFORM_ACTIONS through its paired action', () => {
    const pairs: Record<TableOperation, keyof (typeof PLATFORM_ACTIONS)['Package']> = {
      SELECT: 'read',
      INSERT: 'create',
      UPDATE: 'update',
      DELETE: 'delete',
    };
    for (const op of OPS) {
      const p = m.policies.find((x) => x.table === 'packages' && x.op === op);
      expect(p?.keys, `packages ${op}`).toEqual([PLATFORM_ACTIONS.Package[pairs[op]]]);
    }
  });

  it('every kept policy is the one the map records as the other read', () => {
    for (const [table, names] of Object.entries(KEEP_POLICIES)) {
      const rule = STAFF_TABLE_PERMISSIONS[table as keyof typeof STAFF_TABLE_PERMISSIONS] as { otherRead?: string };
      for (const name of names) expect(rule.otherRead, table).toContain(name);
    }
    for (const table of ANON_SELECT) expect(KEEP_POLICIES[table], `${table}: anon SELECT needs a kept read`).toBeDefined();
  });
});

describe('one operation changed in the map changes exactly that policy and its test cases', () => {
  const changed: Rules = {
    ...STAFF_TABLE_PERMISSIONS,
    ops_alerts: { group: 'permission', ops: { SELECT: ['manage_voice'] }, modules: ['src/lib/data/admin/alerts.ts'] },
  };
  const lines = (s: string) => s.split('\n');
  // Line by line: the change must not move or add lines, only replace them in place.
  const diff = (a: string, b: string) => {
    const la = lines(a);
    const lb = lines(b);
    expect(lb).toHaveLength(la.length);
    const at = la.flatMap((l, i) => (l === lb[i] ? [] : [i]));
    return { at, removed: at.map((i) => la[i]), added: at.map((i) => lb[i]) };
  };

  it('migration: only the ops_alerts SELECT policy differs', () => {
    const d = diff(renderMigrationBody(KEYED, EXISTING), renderMigrationBody(KEYED, EXISTING, changed));
    expect(d.removed).toEqual(["  using ((select public.has_platform_permission('manage_settings')));"]);
    expect(d.added).toEqual(["  using ((select public.has_platform_permission('manage_voice')));"]);
    // The changed line belongs to one policy: the USING clause right after `ops_alerts_select_permission`.
    const after = lines(renderMigrationBody(KEYED, EXISTING, changed));
    expect(after[d.at[0] - 1]).toContain('"ops_alerts_select_permission"');
  });

  it('tests: the ops_alerts SELECT cases now admit the manage_voice holder and refuse the manage_settings one', () => {
    // With channels beside it, both keys have a generated holder.
    const before = renderPgTapTests(['ops_alerts', 'channels'], FIXTURES, COLUMNS).sql;
    const after = renderPgTapTests(['ops_alerts', 'channels'], FIXTURES, COLUMNS, changed).sql;
    expect(before).toContain("'ops_alerts: holder of manage_settings SELECT allowed'");
    expect(after).toContain("'ops_alerts: holder of manage_voice SELECT allowed'");
    expect(after).toContain("'ops_alerts: holder of manage_settings reads no row'");
    expect(after).not.toContain("'ops_alerts: holder of manage_settings SELECT allowed'");
    // channels did not change: every case it had is still there, and the only new ones are for the new actor.
    const channelCases = (sql: string) => sql.split('\n').filter((l) => l.includes("'channels: "));
    const added = channelCases(after).filter((l) => !channelCases(before).includes(l));
    expect(channelCases(before).every((l) => channelCases(after).includes(l))).toBe(true);
    expect(added.length).toBeGreaterThan(0);
    for (const l of added) expect(l).toContain("'channels: holder of manage_voice ");
  });
});

describe('renderPgTapTests: behaviour comes from the rules, not from the SQL', () => {
  const tables = ['packages', 'call_compliance_settings', 'otp_challenges'];
  const r = renderPgTapTests(tables, FIXTURES, COLUMNS);
  const actors = actorsFor(STAFF_TABLE_PERMISSIONS, tables);

  it('declares exactly as many assertions as it renders', () => {
    const asserted = r.sql.split('\n').filter((l) => /^select (is|ok|results_eq|throws_ok|is_empty|policies_are|policy_cmd_is|policy_roles_are|table_privs_are)\(/.test(l));
    expect(asserted).toHaveLength(r.plan);
  });

  it('a closed table refuses every actor every operation with 42501, the owner included', () => {
    for (const a of actors) {
      for (const op of OPS) expect(r.sql).toContain(`'otp_challenges: ${a.id} refused ${op} (no grant)'`);
    }
  });

  it('an operation the map does not grant is refused for everyone (call_compliance_settings INSERT, DELETE)', () => {
    for (const a of actors) {
      expect(r.sql).toContain(`'call_compliance_settings: ${a.id} refused INSERT (no grant)'`);
      expect(r.sql).toContain(`'call_compliance_settings: ${a.id} refused DELETE (no grant)'`);
    }
  });

  it('holders of the operation key are allowed, everyone else is refused or filtered', () => {
    for (const op of ['SELECT', 'UPDATE'] as const) {
      expect(r.sql).toContain(`'call_compliance_settings: owner ${op} allowed'`);
      expect(r.sql).toContain(`'call_compliance_settings: holder of manage_voice ${op} allowed'`);
      expect(r.sql).not.toContain(`'call_compliance_settings: holder of manage_billing ${op} allowed'`);
    }
    expect(r.sql).toContain("'call_compliance_settings: holder of manage_billing reads no row'");
    expect(r.sql).toContain("'call_compliance_settings: signed-in non-staff UPDATE matches no row'");
    expect(r.sql).toContain("'call_compliance_settings: anon refused SELECT (no grant)'");
    expect(r.sql).toContain("'packages: holder of manage_voice refused INSERT (with check)'");
    expect(r.sql).toContain("'packages: holder of manage_billing DELETE allowed'");
  });

  it('a filtered write is followed by a read proving the target row is intact', () => {
    const l = r.sql.split('\n');
    l.forEach((line, i) => {
      if (/^select is_empty\(\$\$(update|delete) /.test(line)) {
        expect(l.slice(i + 1, i + 3).join('\n'), line).toContain('target row intact');
      }
    });
  });

  it('each refusal asserts its reason: a missing grant or a with check violation', () => {
    for (const line of r.sql.split('\n').filter((l) => l.startsWith('select throws_ok('))) {
      if (line.includes('(no grant)')) expect(line).toMatch(/'42501', 'permission denied for table \w+',/);
      else if (line.includes('(with check)')) expect(line).toMatch(/'42501', 'new row violates row-level security policy for table "\w+"',/);
      else throw new Error(`a refusal without a stated reason: ${line}`);
    }
  });

  it('never proves an allowed write with lives_ok', () => {
    expect(r.sql).not.toContain('lives_ok');
  });

  it('checks each generated actor holds exactly the keys the cases assume', () => {
    expect(r.sql).toContain("'holder of manage_voice: has_platform_permission(manage_billing) is false'");
    expect(r.sql).toContain("'owner: has_platform_permission(manage_voice) is true'");
  });

  it('leaves the reads of a kept policy to hand-written cases and says so', () => {
    expect(r.skipped.some((s) => s.startsWith('packages: anon SELECT'))).toBe(true);
    expect(r.sql).not.toContain("'packages: anon refused SELECT");
    expect(renderPgTapFile(r, 't')).toContain('-- not generated: packages: anon SELECT');
  });

  it('refuses to render a per-permission table without a row fixture', () => {
    expect(() => renderPgTapTests(['faq_items', 'voice_purposes'], {}, COLUMNS)).toThrow(/no row fixture for: faq_items, voice_purposes/);
  });

  it('renders all 25 tables', () => {
    expect(() => renderPgTapTests(ALL, FIXTURES, COLUMNS)).not.toThrow();
  });
});

describe('the template refuses shapes the RLS guide warns against', () => {
  it('an UPDATE or DELETE key that cannot SELECT', () => {
    const rules: Rules = { t: { group: 'permission', ops: { SELECT: ['manage_settings'], UPDATE: ['manage_voice'] }, modules: [] } };
    expect(() => renderMigrationBody(['t'], { t: [] }, rules)).toThrow(/t UPDATE: key manage_voice may UPDATE but not SELECT/);
  });

  it('a policy name Postgres would truncate', () => {
    expect(() => policyName('x'.repeat(50), 'SELECT')).toThrow(/over 63 bytes/);
  });

  it('a table outside the map, a table listed twice, missing catalog input, a kept policy that does not exist', () => {
    expect(() => renderMigrationBody(['nope'], { nope: [] })).toThrow(/not in the staff-table map/);
    expect(() => renderMigrationBody(['otp_challenges', 'otp_challenges'], EXISTING)).toThrow(/listed twice/);
    expect(() => renderMigrationBody(['otp_challenges'], {})).toThrow(/existing policies not given/);
    expect(() => renderMigrationBody(['packages'], { packages: ['packages_admin_all'] })).toThrow(/kept policy packages_public_read does not exist/);
  });
});

describe('writing into files the Supabase CLI created', () => {
  it('appends the block to a migration, then replaces only the block', () => {
    const header = '-- ROLLBACK:\n--   grant all on public.x to authenticated;\n';
    const first = mergeIntoMigration(header, 'revoke all on table public."x" from anon, authenticated;');
    expect(first.startsWith(header)).toBe(true);
    expect(first).toContain(BEGIN_MARK);
    const second = mergeIntoMigration(first + '\n-- hand-written tail\n', 'select 2;');
    expect(second.startsWith(header)).toBe(true);
    expect(second).toContain('select 2;');
    expect(second).not.toContain('revoke all');
    expect(second).toContain('-- hand-written tail');
    expect(() => mergeIntoMigration(`${END_MARK}\n${BEGIN_MARK}\n`, 'x')).toThrow(/broken/);
  });

  it('overwrites a test file only when it is generated or the untouched CLI template', () => {
    expect(canOverwriteTestFile('')).toBe(true);
    expect(canOverwriteTestFile('begin;\nselect plan(1);\n-- a comment\nselect pass(\'ok\');\nselect * from finish();\nrollback;\n')).toBe(true);
    expect(canOverwriteTestFile('-- GENERATED by scripts/gen-staff-table-rls.ts from x\nbegin;')).toBe(true);
    expect(canOverwriteTestFile('begin;\nselect plan(1);\nselect is(1, 1);\nrollback;')).toBe(false);
  });
});
