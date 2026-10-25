// Render the grants/policies or the pgTAP cases of staff-tables-permission-rls (design D13) into a file the Supabase
// CLI already created. It never creates a migration or a test file and never applies anything:
//
//   npx supabase migration new <name>
//   npx tsx scripts/gen-staff-table-rls.ts migration --tables otp_challenges,webhook_inbox --file supabase/migrations/<ts>_<name>.sql
//
//   npx supabase test new <name>
//   npx tsx scripts/gen-staff-table-rls.ts test --tables packages --fixtures <fixtures.json> --file supabase/tests/database/<name>.test.sql
//
// The current policy names and one column per table are read from the LOCAL database only (container supabase_db_beta,
// label com.supabase.cli.project=beta), never from production. --dry-run prints instead of writing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  canOverwriteTestFile,
  mergeIntoMigration,
  renderMigrationBody,
  renderPgTapFile,
  renderPgTapTests,
  renderServiceRoleGuard,
  type RowFixture,
} from '@/lib/auth/staff-table-rls';
import { STAFF_TABLE_PERMISSIONS } from '@/lib/auth/staff-table-permissions';

const CONTAINER = 'supabase_db_beta';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function fail(message: string): never {
  console.error(`gen-staff-table-rls: ${message}`);
  process.exit(1);
}

function localQuery(sql: string): string[] {
  const label = execFileSync('docker', ['inspect', CONTAINER, '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], {
    encoding: 'utf8',
  }).trim();
  if (label !== 'beta') fail(`${CONTAINER} is not the local beta stack (label ${label || 'missing'})`);
  return execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-At', '-F', '|', '-c', sql], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const sqlList = (names: readonly string[]) => names.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');

function main(): void {
  const kind = process.argv[2];
  if (kind !== 'migration' && kind !== 'test' && kind !== 'service-role') fail('first argument: migration | test | service-role');
  const tables = (arg('tables') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const file = arg('file');
  if (!tables.length) fail('--tables is required');
  for (const t of tables) if (!(t in STAFF_TABLE_PERMISSIONS)) fail(`${t} is not in the staff-table map`);
  const dryRun = process.argv.includes('--dry-run');
  if (!file && !dryRun) fail('--file is required (create it first with the Supabase CLI), or pass --dry-run');
  const path = file ? resolve(file) : null;
  const rel = path ? relative(process.cwd(), path) : '(stdout)';
  if (path && !existsSync(path)) fail(`${rel} does not exist; create it with \`npx supabase ${kind === 'migration' ? 'migration' : 'test'} new\``);
  const existing = () => (path ? readFileSync(path, 'utf8') : '');
  if (kind === 'service-role') {
    if (path && !/^supabase\/tests\/.+[._]test\.sql$/.test(rel)) fail(`${rel} is not a test file under supabase/tests`);
    if (path && !canOverwriteTestFile(existing())) fail(`${rel} holds hand-written cases`);
    const out = renderPgTapFile(renderServiceRoleGuard(tables), `staff-tables-permission-rls: service_role reaches ${tables.length} tables`);
    if (dryRun || !path) process.stdout.write(out);
    else {
      writeFileSync(path, out);
      console.error(`wrote ${rel}`);
    }
    return;
  }

  let output: string;
  if (kind === 'migration') {
    if (path && !/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(rel)) fail(`${rel} is not a migration created by the CLI`);
    const policies: Record<string, string[]> = Object.fromEntries(tables.map((t) => [t, []]));
    for (const line of localQuery(
      `select tablename, policyname from pg_policies where schemaname = 'public' and tablename in (${sqlList(tables)}) order by 1, 2`,
    )) {
      const [t, name] = line.split('|');
      policies[t].push(name);
    }
    output = mergeIntoMigration(existing(), renderMigrationBody(tables, policies));
  } else {
    // `supabase test new <name>` creates `<name>_test.sql` (CLI 2.122.0); `.test.sql` is the docs' spelling.
    if (path && !/^supabase\/tests\/.+[._]test\.sql$/.test(rel)) fail(`${rel} is not a test file under supabase/tests`);
    if (!canOverwriteTestFile(existing())) fail(`${rel} holds hand-written cases; generated cases go in their own file`);
    const fixturesPath = arg('fixtures');
    const fixtures: Record<string, RowFixture> = fixturesPath ? JSON.parse(readFileSync(resolve(fixturesPath), 'utf8')) : {};
    const columns: Record<string, string> = {};
    for (const line of localQuery(
      `select table_name, min(column_name) from information_schema.columns where table_schema = 'public' and table_name in (${sqlList(tables)}) group by 1`,
    )) {
      const [t, col] = line.split('|');
      columns[t] = col;
    }
    const rendered = renderPgTapTests(tables, fixtures, columns);
    output = renderPgTapFile(rendered, `staff-tables-permission-rls: ${tables.join(', ')}`);
    console.error(`${rendered.plan} assertions; ${rendered.skipped.length} cases left to hand-written tests`);
  }

  if (dryRun || !path) process.stdout.write(output);
  else {
    writeFileSync(path, output);
    console.error(`wrote ${rel}`);
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
