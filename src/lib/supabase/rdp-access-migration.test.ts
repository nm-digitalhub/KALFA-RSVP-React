import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RDP_EVENT_KINDS } from '@/lib/rdp-access/events';

// Regression guard for the remote-desktop approval migration, in the style of
// console-view-grants.test.ts: a textual check over the migration file.
//
// It proves the hardening was WRITTEN, not that it was APPLIED. The migration also carries a
// self-verifying DO block that aborts the whole migration if the live ACL / RLS / trigger state is
// wrong; this test keeps the file itself from drifting before that point. tsc, eslint and the
// behavioural tests never read SQL, which is why a security-relevant omission (a function left
// executable by PUBLIC, a table without RLS) would otherwise go unnoticed.

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith('_rdp_access_approval.sql'));

// Pinned literally so a regex that stops matching fails LOUDLY instead of quietly shrinking the
// set being checked.
const CALLABLE = [
  'rdp_log',
  'rdp_expire_stale',
  'rdp_request_access',
  'rdp_cancel_request',
  'rdp_end_own_grant',
  'rdp_begin_file_issue',
  'rdp_answer_request',
  'rdp_end_grant',
  'rdp_check_tunnel',
  'rdp_sweep',
  'rdp_mark_cut',
  'rdp_record_event',
  'rdp_redact_old_ips',
] as const;

const TRIGGER_FUNCTIONS = [
  'rdp_access_no_truncate',
  'rdp_access_requests_guard',
  'rdp_access_grants_guard',
  'rdp_access_events_guard',
] as const;

const TABLES = ['rdp_access_requests', 'rdp_access_grants', 'rdp_access_events'] as const;

function sql(): string {
  if (!FILE) throw new Error('rdp_access_approval migration not found');
  return readFileSync(join(MIGRATIONS, FILE), 'utf8');
}

// The body of `create or replace function public.<name>(` up to the closing `$$;` line.
function functionBody(body: string, name: string): string {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`, 'i');
  const m = body.match(re);
  if (!m) throw new Error(`function ${name} not found in the migration`);
  return m[0];
}

describe('rdp access approval migration', () => {
  it('exists exactly once', () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('_rdp_access_approval.sql'));
    expect(files).toHaveLength(1);
  });

  it('defines exactly the pinned set of rdp_* functions', () => {
    const names = [...sql().matchAll(/create\s+or\s+replace\s+function\s+public\.(rdp_\w+)\s*\(/gi)]
      .map((m) => m[1])
      .sort();
    expect(names).toEqual([...CALLABLE, ...TRIGGER_FUNCTIONS].sort());
  });

  it.each([...CALLABLE, ...TRIGGER_FUNCTIONS])(
    '%s is SECURITY INVOKER with an empty search_path',
    (name) => {
      const body = functionBody(sql(), name);
      expect(body).toMatch(/security\s+invoker/i);
      expect(body).not.toMatch(/security\s+definer/i);
      expect(body).toMatch(/set\s+search_path\s*=\s*''/i);
    },
  );

  it.each([...CALLABLE, ...TRIGGER_FUNCTIONS])(
    '%s has EXECUTE revoked from public, anon and authenticated',
    (name) => {
      const re = new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
        'i',
      );
      expect(sql()).toMatch(re);
    },
  );

  it('grants EXECUTE to service_role only, for every callable function and no trigger function', () => {
    const body = sql();
    const grants = [...body.matchAll(/grant\s+execute\s+on\s+function\s+([\s\S]*?)\s+to\s+service_role\s*;/gi)]
      .map((m) => m[1])
      .filter((g) => /public\.rdp_/.test(g))
      .join('\n');
    for (const name of CALLABLE) {
      expect(grants, `${name} must be granted to service_role`).toMatch(new RegExp(`public\\.${name}\\s*\\(`));
    }
    for (const name of TRIGGER_FUNCTIONS) {
      expect(grants, `${name} must NOT be executable`).not.toMatch(new RegExp(`public\\.${name}\\s*\\(`));
    }
    // statement-bounded ([^;]) so the match cannot run on into a later `grant ... to authenticated`
    expect(body).not.toMatch(/grant\s+execute\s+on\s+function[^;]*\sto\s+(?:public|anon|authenticated)\b/i);
  });

  it.each(TABLES)('%s has RLS enabled and all browser-role access revoked', (table) => {
    const body = sql();
    expect(body).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    const revoke = body.match(/revoke\s+all\s+on\s+table\s+([\s\S]*?)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i);
    expect(revoke?.[1]).toContain(`public.${table}`);
  });

  it('grants browser roles nothing but narrow column-level SELECT on own rows', () => {
    const body = sql();
    const grants = [...body.matchAll(/grant\s+(\w+)[^;]*?\s+on\s+public\.(rdp_access_\w+)\s+to\s+authenticated\s*;/gi)];
    // only SELECT, and never on the events table
    for (const g of grants) {
      expect(g[1].toLowerCase()).toBe('select');
      expect(g[2]).not.toBe('rdp_access_events');
    }
    expect(grants).toHaveLength(2);
    // column-level, never table-wide
    expect(body).toMatch(/grant\s+select\s*\([^)]*\)\s+on\s+public\.rdp_access_requests/i);
    expect(body).toMatch(/grant\s+select\s*\([^)]*\)\s+on\s+public\.rdp_access_grants/i);
    // the sensitive columns are not in the column grants
    const requestsGrant = body.match(/grant\s+select\s*\(([^)]*)\)\s+on\s+public\.rdp_access_requests/i)?.[1] ?? '';
    expect(requestsGrant).not.toMatch(/request_ip|approver_context|answered_by/);
    const grantsGrant = body.match(/grant\s+select\s*\(([^)]*)\)\s+on\s+public\.rdp_access_grants/i)?.[1] ?? '';
    expect(grantsGrant).not.toMatch(/cut_|user_id|granted_by|ended_by/);
  });

  it('enforces one active grant with a unique partial index on a constant expression', () => {
    expect(sql()).toMatch(
      /create\s+unique\s+index\s+rdp_access_grants_one_active_uq\s+on\s+public\.rdp_access_grants\s*\(\s*\(\s*true\s*\)\s*\)\s+where\s+status\s*=\s*'active'/i,
    );
  });

  it('caps a grant at four hours in the database itself', () => {
    expect(sql()).toMatch(/expires_at\s*<=\s*starts_at\s*\+\s*interval\s+'240 minutes'/i);
  });

  it('uses text + CHECK, never a Postgres enum type', () => {
    expect(sql()).not.toMatch(/create\s+type\s/i);
  });

  it('seeds the permission key once and verifies it is owner-only', () => {
    const body = sql();
    expect([...body.matchAll(/values\s*\(\s*'rdp\.request'/gi)]).toHaveLength(1);
    expect(body).toContain('a non-owner role holds rdp.request by default');
    expect(body).toContain('the owner role does not hold rdp.request');
  });

  it('keeps the audit table append-only and blocks truncate on all three tables', () => {
    const body = sql();
    expect(body).toMatch(/create\s+trigger\s+rdp_access_events_guard\s+before\s+update\s+or\s+delete/i);
    for (const table of TABLES) {
      expect(body).toMatch(
        new RegExp(`create\\s+trigger\\s+${table}_no_truncate\\s+before\\s+truncate\\s+on\\s+public\\.${table}`, 'i'),
      );
    }
  });

  it('writes only the audit event kinds listed in rdp-access/events.ts, each matching the table CHECK', () => {
    const body = sql();
    const fromLog = [...body.matchAll(/rdp_log\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    const fromInserts = [...body.matchAll(/select\s+'([a-z_]+)'\s*,\s*'system'/g)].map((m) => m[1]);
    const allowedFromApp = [...body.matchAll(/p_kind\s+not\s+in\s*\(([^)]*)\)/g)].flatMap((m) =>
      [...m[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1]),
    );
    const used = new Set([...fromLog, ...fromInserts, ...allowedFromApp]);
    expect(used.size).toBeGreaterThan(0);
    for (const kind of used) {
      expect(kind).toMatch(/^[a-z_]{3,40}$/);
      expect(RDP_EVENT_KINDS as readonly string[]).toContain(kind);
    }
    // and nothing pinned is missing from the SQL
    for (const kind of RDP_EVENT_KINDS) expect(used.has(kind)).toBe(true);
  });
});

// ── The follow-up migration ───────────────────────────────────────────────────
// 20261006170320 replaces function bodies (CREATE OR REPLACE keeps the ACL of the original). It must not
// weaken any property the original proved: every function it touches stays SECURITY INVOKER with an empty
// search_path, it introduces no new function, and it never hands EXECUTE to a browser role.
const FIXES_FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith('_rdp_access_approval_fixes.sql'));

function fixesSql(): string {
  if (!FIXES_FILE) throw new Error('rdp_access_approval_fixes migration not found');
  return readFileSync(join(MIGRATIONS, FIXES_FILE), 'utf8');
}

describe('rdp access approval fixes migration', () => {
  it('exists exactly once and sorts after the migration it fixes', () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('_rdp_access_approval_fixes.sql'));
    expect(files).toHaveLength(1);
    expect(FILE && FIXES_FILE && FIXES_FILE > FILE).toBe(true);
  });

  const REPLACED = [...fixesSql().matchAll(/create\s+or\s+replace\s+function\s+public\.(rdp_\w+)\s*\(/gi)].map((m) => m[1]);

  it('replaces only functions that already exist', () => {
    expect(REPLACED.length).toBeGreaterThan(0);
    for (const name of REPLACED) {
      expect([...CALLABLE, ...TRIGGER_FUNCTIONS] as readonly string[]).toContain(name);
    }
  });

  it.each(REPLACED)('%s stays SECURITY INVOKER with an empty search_path', (name) => {
    const body = functionBody(fixesSql(), name);
    expect(body).toMatch(/security\s+invoker/i);
    expect(body).not.toMatch(/security\s+definer/i);
    expect(body).toMatch(/set\s+search_path\s*=\s*''/i);
  });

  it('never grants EXECUTE to a browser role or PUBLIC', () => {
    expect(fixesSql()).not.toMatch(/grant\s+execute[^;]*\sto\s+(?:public|anon|authenticated)\b/i);
  });

  it('B1: the audit table guard lets ON DELETE SET NULL through, and nothing else', () => {
    const body = functionBody(fixesSql(), 'rdp_access_events_guard');
    expect(body).toMatch(/new\.actor_id\s+is\s+null\s+and\s+old\.actor_id\s+is\s+not\s+null/i);
    expect(body).toMatch(/append-only/);
  });

  it('B2: the tunnel check is NULL-safe on the target', () => {
    expect(functionBody(fixesSql(), 'rdp_check_tunnel')).toMatch(
      /p_target\s+is\s+null\s+or\s+v\.target\s+is\s+distinct\s+from\s+p_target/i,
    );
  });

  it('B3: a NULL verdict is invalid, never an approval', () => {
    expect(functionBody(fixesSql(), 'rdp_answer_request')).toMatch(
      /p_verdict\s+is\s+null\s+or\s+p_verdict\s+not\s+in\s*\(\s*'approved'\s*,\s*'denied'\s*\)/i,
    );
  });

  it('the answer function re-checks expiry and the port on the row it locks itself', () => {
    const body = functionBody(fixesSql(), 'rdp_answer_request');
    expect(body).toMatch(/v\.status\s*=\s*'pending'\s+and\s+v\.expires_at\s*<=\s*now\(\)/i);
    expect(body).toMatch(/between\s+1\s+and\s+65535/i);
  });

  it('the expiry sweep never waits on a locked row', () => {
    const body = functionBody(fixesSql(), 'rdp_expire_stale');
    expect([...body.matchAll(/for\s+no\s+key\s+update\s+skip\s+locked/gi)]).toHaveLength(2);
    expect(body).not.toMatch(/for\s+update\s+skip\s+locked/i);
  });

  it('file issue and request access ignore a grant that is past its expiry even if the sweep skipped it', () => {
    expect(functionBody(fixesSql(), 'rdp_begin_file_issue')).toMatch(/x\.expires_at\s*>\s*now\(\)/i);
    expect(functionBody(fixesSql(), 'rdp_request_access')).toMatch(/g\.expires_at\s*>\s*now\(\)/i);
  });

  it('locks rows FOR NO KEY UPDATE so a concurrent audit insert (KEY SHARE) is never blocked', () => {
    const body = fixesSql();
    expect(body).not.toMatch(/\bfor\s+update\b(?!\s+skip)/i);
    expect(functionBody(body, 'rdp_begin_file_issue')).toMatch(/for\s+no\s+key\s+update/i);
    expect(functionBody(body, 'rdp_answer_request')).toMatch(/for\s+no\s+key\s+update/i);
  });

  it('a unique violation is a grant conflict only when it is the one-active-grant lock, decided by constraint name', () => {
    const body = functionBody(fixesSql(), 'rdp_answer_request');
    expect(body).toMatch(/get\s+stacked\s+diagnostics\s+v_constraint\s*=\s*constraint_name/i);
    expect(body).toMatch(/v_constraint\s+is\s+distinct\s+from\s+'rdp_access_grants_one_active_uq'/i);
    expect(body).toMatch(/raise;/i);
    // an expired-but-unmarked competing grant is marked and the insert is retried; otherwise `busy`
    expect(body).toMatch(/v_conf_exp\s*<=\s*now\(\)/i);
    expect(body).toMatch(/'busy'/);
  });

  it('the self-verification block pins the three blocker fixes in the stored function bodies', () => {
    const body = fixesSql();
    expect(body).toContain("position('new.actor_id' in pg_get_functiondef");
    expect(body).toContain("position('p_target is null' in pg_get_functiondef");
    expect(body).toContain("position('p_verdict is null' in pg_get_functiondef");
  });

  it('a grant already confirmed cut is left alone', () => {
    expect(functionBody(fixesSql(), 'rdp_mark_cut')).toMatch(/x\.tunnels_cut_at\s+is\s+null/i);
  });

  it('the ended_reason CHECK cannot pass on NULL (a CHECK only fails on FALSE)', () => {
    const body = fixesSql();
    const check = body.match(/add constraint rdp_access_grants_ended_reason_consistency check \(([\s\S]*?)\)\s*,\s*add constraint/i)?.[1] ?? '';
    expect(check).toMatch(/^\s*coalesce\(/i);
    expect(check).toMatch(/,\s*false\s*\)\s*$/i);
  });

  it('adds the five CHECK constraints and the monotonic event clock', () => {
    const body = fixesSql();
    for (const name of [
      'rdp_access_grants_target_port',
      'rdp_access_grants_files_within_max',
      'rdp_access_grants_ended_reason_consistency',
      'rdp_access_grants_ended_after_start',
      'rdp_access_grants_cut_counters',
    ]) {
      expect(body).toContain(`add constraint ${name}`);
    }
    expect(body).toMatch(/alter\s+column\s+at\s+set\s+default\s+clock_timestamp\(\)/i);
  });

  it('writes only audit event kinds listed in rdp-access/events.ts', () => {
    const body = fixesSql();
    const kinds = [
      ...[...body.matchAll(/rdp_log\(\s*'([a-z_]+)'/g)].map((m) => m[1]),
      ...[...body.matchAll(/select\s+'([a-z_]+)'\s*,\s*'system'/g)].map((m) => m[1]),
    ];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) expect(RDP_EVENT_KINDS as readonly string[]).toContain(kind);
  });

  it('uses text + CHECK, never a Postgres enum type', () => {
    expect(fixesSql()).not.toMatch(/create\s+type\s/i);
  });
});
