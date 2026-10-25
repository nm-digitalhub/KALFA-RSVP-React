import type { PlatformPermissionKey } from './platform-permission-keys.generated';
import {
  operationKeys,
  STAFF_TABLE_PERMISSIONS,
  type StaffTableRule,
  type TableOperation,
} from './staff-table-permissions';

// One template for the 25 staff tables (staff-tables-permission-rls, design D13, task 1.5). Two renderers, both read the
// rules of `staff-table-permissions.ts` and nothing else:
//
// - renderMigrationBody: grants and policies (design D2, D3, D5, D6). A closed table loses every client grant and its
//   staff policies; a per-permission table gets exactly the granted operations and one policy per operation.
// - renderPgTapTests: inventory (design D9 families a, b) and behaviour (family c). The behaviour cases are computed
//   from the rules directly, never from the migration renderer's output, so a mistake in the SQL template is caught by
//   real statements run as real roles, not confirmed by its own text.
//
// What is NOT rendered stays hand-written (HAND_WRITTEN below). Migration and test files are created by
// `npx supabase migration new` / `npx supabase test new`; scripts/gen-staff-table-rls.ts only writes into them.

export type Rules = Readonly<Record<string, StaffTableRule>>;

const OPS: readonly TableOperation[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

// Policies kept as they are on a per-permission table (design D5): the reads for callers outside the staff keys.
// Each must also be named in that table's `otherRead` in the map (asserted by the test).
export const KEEP_POLICIES: Readonly<Record<string, readonly string[]>> = {
  packages: ['packages_public_read'],
  faq_items: ['faq_items_public_read'],
  channels: ['channels_auth_read'],
};

// Tables where `anon` keeps SELECT, for the public read above (design D0, D5). Every other table: no anon privilege.
export const ANON_SELECT: readonly string[] = ['packages', 'faq_items'];

// Written by hand in each stage, never rendered. The generated test of such a table skips only the case named here.
export const HAND_WRITTEN = [
  'the public and signed-in reads kept by KEEP_POLICIES (anon and customer SELECT; channels_auth_read for any user)',
  'the upsert_provider_number RPC, called by each key holder and by a non-holder (provider_numbers)',
  'the six fleet_* RPCs, holder and non-holder',
  'the service-role statement shapes of voice_purpose_attempts',
  'cases for the seeded roles (owner, billing_clerk, auditor, ops_engineer, support_agent) beyond the generated actors',
  'the ROLLBACK header of each migration (prior grants and policy text read from the live catalog)',
  'the row fixture of each per-permission table (RowFixture)',
] as const;

export function policyName(table: string, op: TableOperation): string {
  const name = `${table}_${op.toLowerCase()}_permission`;
  if (Buffer.byteLength(name) > 63) throw new Error(`${table} ${op}: policy name over 63 bytes: ${name}`);
  return name;
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

function rulesFor(rules: Rules, tables: readonly string[]): [string, StaffTableRule][] {
  if (tables.length === 0) throw new Error('no table given');
  if (new Set(tables).size !== tables.length) throw new Error(`a table is listed twice: ${tables.join(', ')}`);
  return tables.map((table) => {
    const rule = rules[table];
    if (!rule) throw new Error(`${table} is not in the staff-table map`);
    return [table, rule];
  });
}

export function grantedOps(rule: StaffTableRule): TableOperation[] {
  return OPS.filter((op) => operationKeys(rule, op).length > 0);
}

// The Supabase RLS guide: "To perform an UPDATE operation, a corresponding SELECT policy is required." A DELETE with a
// WHERE clause reads the rows it targets the same way. So every key that may update or delete must also be able to read.
export function assertReadCoversWrites(table: string, rule: StaffTableRule): void {
  const read = new Set(operationKeys(rule, 'SELECT'));
  for (const op of ['UPDATE', 'DELETE'] as const) {
    for (const key of operationKeys(rule, op)) {
      if (!read.has(key)) throw new Error(`${table} ${op}: key ${key} may ${op} but not SELECT`);
    }
  }
}

function predicate(keys: readonly PlatformPermissionKey[]): string {
  return keys.map((key) => `(select public.has_platform_permission(${literal(key)}))`).join(' or ');
}

// existingPolicies: the policy names on each table now, read from the local catalog (identical to the live one, design
// access map). Every one is dropped except KEEP_POLICIES; a name that no longer exists makes `drop policy` fail loudly.
export function renderMigrationBody(
  tables: readonly string[],
  existingPolicies: Readonly<Record<string, readonly string[]>>,
  rules: Rules = STAFF_TABLE_PERMISSIONS,
): string {
  const out: string[] = [];
  for (const [table, rule] of rulesFor(rules, tables)) {
    const existing = existingPolicies[table];
    if (!existing) throw new Error(`${table}: existing policies not given`);
    const keep = KEEP_POLICIES[table] ?? [];
    if (rule.group === 'closed' && keep.length) throw new Error(`${table}: a closed table keeps no policy`);
    for (const name of keep) if (!existing.includes(name)) throw new Error(`${table}: kept policy ${name} does not exist`);
    const t = `public.${ident(table)}`;

    out.push(`-- ${table}: ${rule.group === 'closed' ? 'closed, service role only (design D2)' : 'per operation (design D3)'}`);
    out.push(`revoke all on table ${t} from anon, authenticated;`);
    for (const name of existing) if (!keep.includes(name)) out.push(`drop policy ${ident(name)} on ${t};`);

    if (rule.group === 'permission') {
      assertReadCoversWrites(table, rule);
      const ops = grantedOps(rule);
      out.push(`grant ${ops.map((op) => op.toLowerCase()).join(', ')} on table ${t} to authenticated;`);
      if (ANON_SELECT.includes(table)) out.push(`grant select on table ${t} to anon;`);
      for (const op of ops) {
        const p = predicate(operationKeys(rule, op));
        const head = `create policy ${ident(policyName(table, op))} on ${t} for ${op.toLowerCase()} to authenticated`;
        if (op === 'SELECT' || op === 'DELETE') out.push(`${head}\n  using (${p});`);
        if (op === 'INSERT') out.push(`${head}\n  with check (${p});`);
        if (op === 'UPDATE') out.push(`${head}\n  using (${p})\n  with check (${p});`);
      }
    } else if (ANON_SELECT.includes(table)) {
      throw new Error(`${table}: a closed table grants nothing to anon`);
    }
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// pgTAP

// The row a per-permission table's behaviour cases act on. Hand-written per stage (HAND_WRITTEN).
export interface RowFixture {
  seed: string; // SQL run as postgres before any role switch; creates the row
  row: string; // WHERE predicate matching exactly that row
  probe: string; // column (or expression) returned as text to prove a read, a write or an intact row
  probeValue: string; // its value for the seeded row
  insert?: string; // `(cols) values (...)` for the INSERT cases, when the table grants INSERT
  insertValue?: string; // the probe value of the inserted row
  update?: string; // `col = expr` for the UPDATE cases; must leave `probe` unchanged
}

interface Actor {
  id: string; // stable label in test descriptions
  uid: string | null; // null: anon
  keys: 'all' | readonly PlatformPermissionKey[]; // what the actor holds; 'all' is the owner role
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

// Generated actors: the owner, one staff member per key the given tables use (a temporary role holding exactly that
// key), a staff member whose role holds no key, a signed-in non-staff user, and anon.
export function actorsFor(rules: Rules, tables: readonly string[]): Actor[] {
  const keys = [
    ...new Set(rulesFor(rules, tables).flatMap(([, rule]) => OPS.flatMap((op) => operationKeys(rule, op)))),
  ].sort();
  return [
    { id: 'owner', uid: uuid(1), keys: 'all' },
    ...keys.map((key, i) => ({ id: `holder of ${key}`, uid: uuid(100 + i), keys: [key] })),
    { id: 'staff holding no key', uid: uuid(2), keys: [] },
    { id: 'signed-in non-staff', uid: uuid(3), keys: [] },
    { id: 'anon', uid: null, keys: [] },
  ];
}

function renderActorSetup(actors: readonly Actor[]): string[] {
  const out = ['-- Actors, inside the rolled-back transaction (generated).'];
  const users = actors.filter((a) => a.uid);
  out.push(
    `insert into auth.users (id, email) values\n  ${users
      .map((a) => `(${literal(a.uid!)}, ${literal(`rls-${a.uid!.slice(-4)}@test.invalid`)})`)
      .join(',\n  ')};`,
  );
  actors.forEach((a, i) => {
    if (!a.uid || a.id === 'signed-in non-staff') return;
    if (a.keys === 'all') {
      out.push(
        `insert into public.platform_staff (user_id, role_id, granted_by)\n  select ${literal(a.uid)}, id, ${literal(a.uid)} from public.platform_roles where is_owner_role;`,
      );
      return;
    }
    const role = uuid(1000 + i);
    out.push(
      `insert into public.platform_roles (id, name, label, is_owner_role, rank) values (${literal(role)}, ${literal(`rls_test_${i}`)}, ${literal(`RLS test: ${a.id}`)}, false, 0);`,
    );
    for (const key of a.keys) {
      out.push(
        `insert into public.platform_role_permissions (role_id, permission_id)\n  select ${literal(role)}, id from public.platform_permission_definitions where key = ${literal(key)};`,
      );
    }
    out.push(
      `insert into public.platform_staff (user_id, role_id, granted_by) values (${literal(a.uid)}, ${literal(role)}, ${literal(a.uid)});`,
    );
  });
  return out;
}

const actAs = (a: Actor): string =>
  a.uid ? `set local role authenticated;\nset local request.jwt.claim.sub = ${literal(a.uid)};` : 'set local role anon;';

const holds = (a: Actor, keys: readonly PlatformPermissionKey[]): boolean =>
  a.uid !== null && (a.keys === 'all' || keys.some((k) => (a.keys as readonly string[]).includes(k)));

const dollar = (sql: string): string => `$$${sql}$$`;

// Both a missing grant and a `with check` violation raise 42501; the message tells them apart (Postgres 17, measured on
// the local stack 25.10.2026), so each refusal asserts its reason, not only its code.
const NO_GRANT = (table: string) => literal(`permission denied for table ${table}`);
const WITH_CHECK = (table: string) => literal(`new row violates row-level security policy for table "${table}"`);

export interface RenderedTests {
  sql: string;
  plan: number;
  // Cases deliberately not generated, each covered by a hand-written test (HAND_WRITTEN).
  skipped: string[];
}

export function renderPgTapTests(
  tables: readonly string[],
  fixtures: Readonly<Record<string, RowFixture>>,
  // Any column of each table, for the UPDATE refusal without a grant (`set c = c where false`); several have no `id`.
  columns: Readonly<Record<string, string>>,
  rules: Rules = STAFF_TABLE_PERMISSIONS,
): RenderedTests {
  const entries = rulesFor(rules, tables);
  const missing = entries.filter(([t, r]) => r.group === 'permission' && !fixtures[t]).map(([t]) => t);
  if (missing.length) throw new Error(`no row fixture for: ${missing.join(', ')}`);

  const actors = actorsFor(rules, tables);
  const cases: string[] = [];
  const skipped: string[] = [];
  let plan = 0;
  // `add` is one assertion; `raw` is a statement that asserts nothing (a re-seed).
  const add = (sql: string) => {
    cases.push(sql);
    plan += 1;
  };
  const raw = (sql: string) => cases.push(sql);
  const out = renderActorSetup(actors);

  // The actors hold what the cases assume (independent of every policy under test).
  const allKeys = [...new Set(actors.flatMap((a) => (a.keys === 'all' ? [] : a.keys)))];
  for (const a of actors) {
    if (!a.uid) continue;
    for (const key of allKeys) {
      const expected = a.keys === 'all' || (a.keys as readonly string[]).includes(key);
      add(
        `${actAs(a)}\nselect is((select public.has_platform_permission(${literal(key)})), ${expected}, ${literal(`${a.id}: has_platform_permission(${key}) is ${expected}`)});`,
      );
    }
  }

  for (const [table, rule] of entries) {
    const t = `public.${ident(table)}`;
    const keep = KEEP_POLICIES[table] ?? [];
    const ops = rule.group === 'closed' ? [] : grantedOps(rule);
    const label = (s: string) => literal(`${table}: ${s}`);

    // Inventory (family a): the policy names, and per generated policy its command and roles.
    const names = [...ops.map((op) => policyName(table, op)), ...keep].sort();
    add(`reset role;\nselect policies_are('public', ${literal(table)}, array[${names.map(literal).join(', ')}]::name[], ${label('policies')});`);
    for (const op of ops) {
      const n = literal(policyName(table, op));
      add(`select policy_cmd_is('public', ${literal(table)}, ${n}::name, ${literal(op)}, ${label(`${op} policy command`)});`);
      add(`select policy_roles_are('public', ${literal(table)}, ${n}::name, array['authenticated']::name[], ${label(`${op} policy roles`)});`);
    }
    // Privileges (family b). table_privs_are does not know MAINTAIN (PG 17), so it is checked apart.
    const anonPrivs = ANON_SELECT.includes(table) ? ['SELECT'] : [];
    add(`select table_privs_are('public', ${literal(table)}, 'authenticated', array[${ops.map(literal).join(', ')}]::name[], ${label('authenticated privileges')});`);
    add(`select table_privs_are('public', ${literal(table)}, 'anon', array[${anonPrivs.map(literal).join(', ')}]::name[], ${label('anon privileges')});`);
    add(`select ok(not has_table_privilege('authenticated', ${literal(`public.${table}`)}, 'MAINTAIN') and not has_table_privilege('anon', ${literal(`public.${table}`)}, 'MAINTAIN'), ${label('no MAINTAIN for client roles')});`);

    // Behaviour (family c), from the rules only. An operation without a grant is refused for everyone, the owner
    // included, before any policy runs; these statements need no row.
    const col = columns[table];
    if (!col) throw new Error(`${table}: no column given for the UPDATE refusal`);
    const noGrant: Record<TableOperation, string> = {
      SELECT: `select 1 from ${t} limit 1`,
      INSERT: `insert into ${t} default values`,
      UPDATE: `update ${t} set ${ident(col)} = ${ident(col)} where false`,
      DELETE: `delete from ${t} where false`,
    };
    for (const op of OPS.filter((o) => !ops.includes(o))) {
      for (const a of actors) {
        add(`${actAs(a)}\nselect throws_ok(${dollar(noGrant[op])}, '42501', ${NO_GRANT(table)}, ${label(`${a.id} refused ${op} (no grant)`)});`);
      }
    }
    if (rule.group === 'closed') continue;

    const f = fixtures[table];
    const where = `where ${f.row}`;
    const intact = `reset role;\nselect results_eq(${dollar(`select (${f.probe})::text from ${t} ${where}`)}, array[${literal(f.probeValue)}], ${label('target row intact')});`;
    out.push(`-- ${table}: fixture (hand-written)`, 'reset role;', f.seed.trim().replace(/;?$/, ';'));

    const statement = (op: TableOperation, returning: boolean): string => {
      const ret = returning ? ` returning (${f.probe})::text` : '';
      if (op === 'SELECT') return `select (${f.probe})::text from ${t} ${where}`;
      if (op === 'INSERT') {
        if (!f.insert) throw new Error(`${table}: the map grants INSERT, the fixture has no insert`);
        return `insert into ${t} ${f.insert}${ret}`;
      }
      if (op === 'UPDATE') {
        if (!f.update) throw new Error(`${table}: the map grants UPDATE, the fixture has no update`);
        return `update ${t} set ${f.update} ${where}${ret}`;
      }
      return `delete from ${t} ${where}${ret}`;
    };

    // Refusals first, the row is still there; then the allowed reads and writes; the holder's DELETE last.
    for (const op of ops) {
      const keys = operationKeys(rule, op);
      for (const a of actors.filter((x) => !holds(x, keys))) {
        if (op === 'SELECT' && keep.length) {
          skipped.push(`${table}: ${a.id} SELECT (a kept read policy also applies; hand-written)`);
          continue;
        }
        if (!a.uid && !(op === 'SELECT' && ANON_SELECT.includes(table))) {
          add(`${actAs(a)}\nselect throws_ok(${dollar(statement(op, false))}, '42501', ${NO_GRANT(table)}, ${label(`anon refused ${op} (no grant)`)});`);
          continue;
        }
        if (op === 'INSERT') {
          add(`${actAs(a)}\nselect throws_ok(${dollar(statement(op, false))}, '42501', ${WITH_CHECK(table)}, ${label(`${a.id} refused INSERT (with check)`)});`);
        } else if (op === 'SELECT') {
          add(`${actAs(a)}\nselect is_empty(${dollar(statement(op, false))}, ${label(`${a.id} reads no row`)});`);
        } else {
          add(`${actAs(a)}\nselect is_empty(${dollar(statement(op, true))}, ${label(`${a.id} ${op} matches no row`)});`);
          add(intact);
        }
      }
    }
    const order: TableOperation[] = ['SELECT', 'UPDATE', 'INSERT', 'DELETE'];
    for (const op of order.filter((o) => ops.includes(o))) {
      const keys = operationKeys(rule, op);
      const allowed = actors.filter((x) => holds(x, keys));
      allowed.forEach((a, i) => {
        if (op === 'DELETE' && i > 0) raw(`reset role;\n${f.seed.trim().replace(/;?$/, ';')}`); // each holder deletes a fresh row
        const expected = op === 'INSERT' ? f.insertValue : f.probeValue;
        if (op === 'INSERT' && expected === undefined) throw new Error(`${table}: the fixture has no insertValue`);
        add(`${actAs(a)}\nselect results_eq(${dollar(statement(op, op !== 'SELECT'))}, array[${literal(expected!)}], ${label(`${a.id} ${op} allowed`)});`);
        if (op === 'INSERT') {
          // One insert per holder would collide on a unique key: remove the inserted row as postgres.
          add(`reset role;\nselect results_eq(${dollar(`delete from ${t} where (${f.probe})::text = ${literal(expected!)} returning (${f.probe})::text`)}, array[${literal(expected!)}], ${label(`cleanup after ${a.id} INSERT`)});`);
        }
      });
    }
  }

  out.push('', ...cases);
  return { sql: out.join('\n'), plan, skipped };
}

// Task 1.4: the server keeps reaching every table, before and after each stage. service_role bypasses RLS but not grants
// (design D0), so this proves no stage revoked from it.
export function renderServiceRoleGuard(tables: readonly string[], rules: Rules = STAFF_TABLE_PERMISSIONS): RenderedTests {
  const cases: string[] = ['set local role service_role;'];
  let plan = 0;
  for (const [table] of rulesFor(rules, tables)) {
    const label = (s: string) => literal(`${table}: ${s}`);
    cases.push(`select lives_ok(${dollar(`select count(*) from public.${ident(table)}`)}, ${label('service_role reads')});`);
    // One call per privilege: has_table_privilege with a list answers whether ANY of them is held (a mutation that
    // revoked SELECT alone still passed a 'SELECT,INSERT,UPDATE,DELETE' check, 25.10.2026).
    const all = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
      .map((p) => `has_table_privilege('service_role', ${literal(`public.${table}`)}, '${p}')`)
      .join(' and ');
    cases.push(`select ok(${all}, ${label('service_role holds select, insert, update and delete')});`);
    plan += 2;
  }
  return { sql: cases.join('\n'), plan, skipped: [] };
}

export function renderPgTapFile(rendered: RenderedTests, title: string): string {
  return [
    `-- ${title}`,
    '-- GENERATED by scripts/gen-staff-table-rls.ts from src/lib/auth/staff-table-permissions.ts. Do not edit by hand;',
    '-- hand-written cases live in their own test file (HAND_WRITTEN in src/lib/auth/staff-table-rls.ts).',
    ...rendered.skipped.map((s) => `-- not generated: ${s}`),
    'begin;',
    'create extension if not exists pgtap with schema extensions;',
    `select plan(${rendered.plan});`,
    rendered.sql,
    'select * from finish();',
    'rollback;',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing into files the Supabase CLI created

export const BEGIN_MARK = '-- BEGIN GENERATED: scripts/gen-staff-table-rls.ts (do not edit between the marks)';
export const END_MARK = '-- END GENERATED';

// A migration keeps its hand-written part (the ROLLBACK header, any exception); only the marked block is replaced.
export function mergeIntoMigration(existing: string, body: string): string {
  const block = `${BEGIN_MARK}\n${body.trimEnd()}\n${END_MARK}\n`;
  const begin = existing.indexOf(BEGIN_MARK);
  const end = existing.indexOf(END_MARK);
  if (begin === -1 && end === -1) return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}`;
  if (begin === -1 || end === -1 || end < begin) throw new Error('the generated marks are broken; fix the file by hand');
  return existing.slice(0, begin) + block + existing.slice(end + END_MARK.length).replace(/^\n/, '');
}

// A generated test file is wholly generated: write it only over itself or over the untouched template of
// `supabase test new`, never over hand-written cases.
export function canOverwriteTestFile(existing: string): boolean {
  if (existing.includes('-- GENERATED by scripts/gen-staff-table-rls.ts')) return true;
  const code = existing
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean);
  return code.length === 0 || code.every((line) => /^(begin;|rollback;|select plan\(\d+\);|select \* from finish\(\);|select pass\(.*\);)$/i.test(line));
}
