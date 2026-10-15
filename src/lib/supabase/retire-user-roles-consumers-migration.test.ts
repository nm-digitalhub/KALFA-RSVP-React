import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for the migration that retires the last consumers of the legacy user_roles.admin
// flag, in the style of rdp-access-migration.test.ts: a textual check over the migration file.
//
// It proves the change was WRITTEN, not that it was APPLIED. The migration also carries a
// self-verifying DO block that aborts it if the live function bodies, policies or ACLs are wrong;
// this test keeps the file itself from drifting before that point (tsc, eslint and the behavioural
// tests never read SQL).

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => f.endsWith('_retire_user_roles_admin_consumers.sql'));

// Pinned literally so a regex that stops matching fails LOUDLY instead of quietly shrinking the set.
const FLEET_FUNCTIONS = [
  'fleet_answer_request',
  'fleet_goal_abandon',
  'fleet_goal_create',
  'fleet_goal_pause',
  'fleet_goal_resume',
  'fleet_owner_request',
] as const;

function sql(): string {
  if (FILES.length !== 1) throw new Error(`expected exactly one migration, found ${FILES.length}`);
  return readFileSync(join(MIGRATIONS, FILES[0]), 'utf8');
}

// The body of `create or replace function public.<name>(` up to the closing `$function$;` line.
function functionBody(body: string, name: string): string {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\n\\$function\\$;`,
    'i',
  );
  const m = body.match(re);
  if (!m) throw new Error(`function ${name} not found in the migration`);
  return m[0];
}

describe('retire user_roles admin consumers migration', () => {
  it('exists exactly once', () => {
    expect(FILES).toHaveLength(1);
  });

  it.each(FLEET_FUNCTIONS)('%s gates on manage_settings and refuses with SQLSTATE 42501', (name) => {
    const body = functionBody(sql(), name);
    expect(body).toMatch(/security\s+definer/i);
    // search_path stays empty, so the permission function must be schema-qualified.
    expect(body).toMatch(/set\s+search_path\s+to\s+''/i);
    expect(body).toContain("if not public.has_platform_permission('manage_settings') then");
    expect(body).toContain(`raise exception '${name}: not permitted' using errcode = '42501';`);
    expect(body).not.toMatch(/has_role/i);
    expect(body).not.toContain('admin only');
  });

  it('moves both voice policies to manage_voice and keeps the initplan wrapper', () => {
    const body = sql();
    expect(body).toMatch(
      /alter\s+policy\s+voice_purposes_admin_all\s+on\s+public\.voice_purposes\s+using\s+\(\(\s*select\s+public\.has_platform_permission\('manage_voice'\)\s*\)\)\s+with\s+check\s+\(\(\s*select\s+public\.has_platform_permission\('manage_voice'\)\s*\)\)/i,
    );
    expect(body).toMatch(
      /alter\s+policy\s+voice_purpose_attempts_admin_read\s+on\s+public\.voice_purpose_attempts\s+using\s+\(\(\s*select\s+public\.has_platform_permission\('manage_voice'\)\s*\)\)/i,
    );
  });

  it('drops claim_first_admin and takes org_role_rank away from the browser roles', () => {
    const body = sql();
    expect(body).toMatch(/drop\s+function\s+if\s+exists\s+public\.claim_first_admin\(\)/i);
    expect(body).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.org_role_rank\(uuid\)\s+from\s+public,\s*anon,\s*authenticated/i,
    );
  });

  it('introduces no new permission key (the gate reuses the keys the application already enforces)', () => {
    expect(sql()).not.toMatch(/insert\s+into\s+public\.platform_permission_definitions/i);
  });

  it('proves the result inside the same transaction', () => {
    const body = sql();
    expect(body).toContain('expected 6 fleet functions');
    expect(body).toContain('a policy still references has_role');
    expect(body).toContain('claim_first_admin still exists');
    expect(body).toContain('org_role_rank is still executable by a browser role');
  });
});
