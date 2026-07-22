import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard, not a unit test: every `console_*` view must have its write
// privileges explicitly revoked from `authenticated` in the migration corpus.
//
// WHY THIS EXISTS. The schema's default privileges hand `authenticated` the full
// arwdDxtm set on every newly created relation. The obvious-looking pair
//
//     revoke all on public.console_x from anon;
//     grant  select on public.console_x to authenticated;
//
// does NOT close that: a grant adds, it never removes what the defaults already
// gave. So the view ships readable AND writable by every logged-in user, and
// because console views are owned by `postgres` (rolbypassrls, no
// security_invoker) a write through an auto-updatable one is rewritten onto the
// base table with RLS bypassed entirely.
//
// This has now happened TWICE. Migration 20260720193844 was written specifically
// to close it across six views; one day later 20260721163850 created the seventh
// with the same two-line pattern and reopened it. It was caught only because the
// grants were read back from the live database by hand. The class of mistake is
// invisible to tsc, eslint and every behavioral test — none of them read SQL.
//
// SCOPE AND LIMITS. This is a textual check over the migration files, not a
// permission audit of the live database:
//   - It proves a revoke was WRITTEN, not that it was APPLIED. Manual DDL run in
//     the Supabase dashboard can still drift the live grants away from the repo;
//     `npm run verify:db` is what checks the live side.
//   - `create or replace view` PRESERVES existing grants (verified live), so a
//     later redefinition of an already-hardened view does not need its own
//     revoke. Only the FIRST creation introduces default privileges, so that is
//     the point this guard anchors on.

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

// `create or replace view [public.]console_foo as` → "console_foo".
//
// The schema prefix is OPTIONAL and that is load-bearing: 20260720061244 writes
// `create or replace view console_events as` with no prefix, and an earlier
// draft of this guard required `public.` — so it silently covered 4 of the 7
// views and passed. A guard that inspects half a surface while reporting green
// is worse than none, so the corpus count is asserted against the live view list
// in `covers every console view` below.
const CREATE_RE = /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?(console_\w+)/gi;

// A `revoke ... from authenticated;` statement may name several views at once
// (20260720193844 revokes six in one statement), so the whole statement body is
// captured and each console view inside it counted. `revoke all on ... from
// anon` must NOT satisfy this — the role is what makes the difference, which is
// exactly the bug — so the role is part of the pattern. `from anon, authenticated`
// and `from authenticated, anon` both count.
const REVOKE_RE = /revoke\s+[\s\S]*?\bfrom\s+[^;]*\bauthenticated\b[^;]*;/gi;
const VIEW_IN_STATEMENT = /(?:public\.)?(console_\w+)/gi;

type Statement = { version: string; views: string[] };

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

// Migrations are applied in filename order, so the filename IS the ordering key.
function collect(re: RegExp, body: string): string[] {
  return [...body.matchAll(re)].flatMap((m) =>
    // For CREATE_RE the view name is the capture group; for REVOKE_RE the match
    // is a whole statement whose console views have to be pulled out of it.
    m[1] ? [m[1]] : [...m[0].matchAll(VIEW_IN_STATEMENT)].map((v) => v[1]),
  );
}

// The console views the application actually exposes. Pinned literally so that a
// regex that stops matching (a new `create` spelling, a moved directory) fails
// LOUDLY here instead of quietly shrinking the set this suite checks — which is
// how the first version of this guard came to cover only 4 of the 7.
const EXPECTED_VIEWS = [
  'console_call_analysis',
  'console_campaign_targets',
  'console_campaigns',
  'console_event_guests',
  'console_events',
  'console_me',
  'console_rsvp_results',
] as const;

describe('console_* views are never left writable by `authenticated`', () => {
  const files = migrationFiles();
  const creates: Statement[] = [];
  const revokes: Statement[] = [];

  for (const file of files) {
    const body = readFileSync(join(MIGRATIONS, file), 'utf8');
    const version = file.split('_')[0];
    const created = collect(CREATE_RE, body);
    const revoked = collect(REVOKE_RE, body);
    if (created.length) creates.push({ version, views: created });
    if (revoked.length) revokes.push({ version, views: revoked });
  }

  // Anti-no-op: the parser must still see EVERY console view. If a future
  // migration spells `create` differently, this fails instead of quietly
  // dropping that view from the checks below.
  it('covers every console view', () => {
    const found = [...new Set(creates.flatMap((c) => c.views))].sort();
    expect(found).toEqual([...EXPECTED_VIEWS]);
  });

  const firstCreated = new Map<string, string>();
  for (const c of creates) {
    for (const v of c.views) if (!firstCreated.has(v)) firstCreated.set(v, c.version);
  }

  for (const [view, createdAt] of firstCreated) {
    it(`${view} is revoked from authenticated at or after ${createdAt}`, () => {
      const revokedAt = revokes
        .filter((r) => r.views.includes(view))
        .map((r) => r.version)
        .filter((v) => v >= createdAt);
      expect(
        revokedAt,
        `${view} is created in ${createdAt} but never appears in a ` +
          '`revoke ... from authenticated` at or after it. A `grant select` does ' +
          'NOT remove the write privileges the schema default privileges already ' +
          'granted — add an explicit `revoke all on public.' +
          `${view} from authenticated;\` before the grant.`,
      ).not.toHaveLength(0);
    });
  }
});

// The LATEST definition of each console view is what the live database runs
// (`create or replace` swaps the body wholesale), so these two guards read the
// last create statement per view, in migration order.
describe('console_* view bodies — latest definition invariants', () => {
  // A whole `create [or replace] view console_x ... ;` statement. View bodies
  // here contain no internal semicolons, so non-greedy-to-semicolon is the
  // statement boundary.
  const STATEMENT_RE = /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?(console_\w+)[\s\S]*?;/gi;

  const latest = new Map<string, { version: string; body: string }>();
  for (const file of migrationFiles()) {
    const body = readFileSync(join(MIGRATIONS, file), 'utf8');
    const version = file.split('_')[0];
    for (const m of body.matchAll(STATEMENT_RE)) {
      latest.set(m[1], { version, body: m[0] });
    }
  }

  it('parses the same view set as the grants guard (anti-no-op)', () => {
    expect([...latest.keys()].sort()).toEqual([...EXPECTED_VIEWS]);
  });

  // Staff-model authorization (user correction, 2026-07-22): the console is a
  // staff-wide surface. Every console view must be gated by is_console_agent()
  // — which itself requires is_staff() (20260720234500) — EXCEPT console_me,
  // whose gate is the self-row predicate `ca.user_id = auth.uid()` (a different
  // but equally closed gate; it lists the caller's own enrollment row or
  // nothing). A regular org user is not a console agent and gets zero rows.
  for (const [view, { version, body }] of latest) {
    if (view === 'console_me') {
      it('console_me (exempt) keeps its self-row gate', () => {
        expect(body).toContain('auth.uid()');
      });
      continue;
    }
    it(`${view} latest definition (${version}) is gated by is_console_agent()`, () => {
      expect(body).toContain('is_console_agent()');
    });
  }

  // Billing internals never reach a console surface: reach state is exposed
  // ONLY as the derived reached_at scalar — the price locked for that reach
  // must not appear in any console view body, ever.
  it('no console view exposes locked_price', () => {
    for (const [view, { body }] of latest) {
      expect(body, `${view} must never select locked_price`).not.toContain('locked_price');
    }
  });
});
