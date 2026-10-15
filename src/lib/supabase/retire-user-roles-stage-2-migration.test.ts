import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guard for the stage-2 migration that DELETES a table (has_role, user_roles, app_role). A textual check over the
// migration file: tsc, eslint and the behavioural tests never read SQL. It proves the safety properties were
// WRITTEN; the migration's own DO blocks enforce them at apply time.

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => f.endsWith('_retire_user_roles_stage_2.sql'));

function sql(): string {
  if (FILES.length !== 1) throw new Error(`expected exactly one migration, found ${FILES.length}`);
  return readFileSync(join(MIGRATIONS, FILES[0]), 'utf8');
}

// The executable part: everything that is not a `--` comment line.
function code(): string {
  return sql()
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

describe('retire user_roles stage 2 migration', () => {
  it('exists exactly once, and sorts after stage 1', () => {
    expect(FILES).toHaveLength(1);
    const stage1 = readdirSync(MIGRATIONS).find((f) => f.endsWith('_retire_user_roles_admin_consumers.sql'));
    expect(stage1).toBeDefined();
    expect(FILES[0] > (stage1 as string)).toBe(true);
  });

  it('never uses CASCADE: a missed dependency must fail the migration, not silently drop it', () => {
    expect(code()).not.toMatch(/\bcascade\b/i);
  });

  it('drops the function, then the table, then the enum, with plain DROPs', () => {
    const body = code();
    const fn = body.search(/drop\s+function\s+public\.has_role\(uuid,\s*public\.app_role\)\s*;/i);
    const table = body.search(/drop\s+table\s+public\.user_roles\s*;/i);
    const type = body.search(/drop\s+type\s+public\.app_role\s*;/i);
    expect(fn).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(fn);
    expect(type).toBeGreaterThan(table);
    expect(body).not.toMatch(/drop\s+(function|table|type)\s+if\s+exists/i);
  });

  it('checks every dependency kind before dropping, and the checks come first', () => {
    const body = code();
    const firstDrop = body.search(/drop\s+function/i);
    for (const check of [
      'policy(ies) still reference',
      'function(s) still reference',
      'view(s) depend on user_roles',
      'foreign key(s) point into user_roles',
      'trigger(s) on user_roles',
      'use the app_role type',
      'non-admin row(s)',
    ]) {
      const at = body.indexOf(check);
      expect(at, check).toBeGreaterThan(-1);
      expect(at, `${check} must precede the first DROP`).toBeLessThan(firstDrop);
    }
  });

  it('proves the result in the same transaction', () => {
    const body = code();
    for (const proof of ['has_role still exists', 'user_roles still exists', 'app_role still exists']) {
      expect(body, proof).toContain(proof);
    }
  });

  it('records where the three rows are backed up and how to roll back', () => {
    const text = sql();
    expect(text).toContain('ops-evidence/user_roles-backup-20261015.sql');
    expect(text).toMatch(/ROLLBACK/);
    expect(text).toMatch(/create type public\.app_role as enum/i);
    expect(text).toMatch(/create policy ur_self_read/i);
  });

  it('records in its header that it has been applied, and no longer warns "do not push"', () => {
    // It was applied on 2026-10-15; a stale "do not db push" warning on an applied migration would mislead.
    expect(sql()).toMatch(/STATUS: APPLIED to the live database on 15\.10\.2026/);
    expect(sql()).not.toMatch(/Do not `supabase db push` until/);
  });
});
