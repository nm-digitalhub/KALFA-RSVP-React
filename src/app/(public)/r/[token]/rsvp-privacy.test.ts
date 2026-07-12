import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Privacy tripwire for finding B-2, not a unit test of behavior: guests.note
// is the OWNER-INTERNAL note and must never reach the public RSVP surface.
// The public payload exposes only the guest-supplied guests.rsvp_note
// (projected by get_rsvp_by_token, written by submit_rsvp). These checks are
// textual on purpose — they fail CI loudly if anyone re-introduces a
// `guest.note` / `g.note` reference on the public page or re-points the RPCs
// at the owner-internal column, instead of shipping a silent privacy leak.

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

// Matches `guest.note` / `g.note` but NOT `guest.rsvp_note` / `g.rsvp_note`
// (`_` is a word character, so `\bnote` cannot match inside `rsvp_note`).
const OWNER_NOTE_MEMBER = /\b(?:guest|g)\.note\b/;

describe('public RSVP page never touches the owner-internal guests.note', () => {
  for (const file of ['rsvp-form.tsx', 'page.tsx']) {
    it(`${file} has no guest.note / g.note reference`, () => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(OWNER_NOTE_MEMBER);
    });
  }

  it('rsvp-form.tsx prefills the note field from guest.rsvp_note', () => {
    const source = readFileSync(join(__dirname, 'rsvp-form.tsx'), 'utf8');
    expect(source).toContain('guest.rsvp_note');
  });
});

// Latest *_rsvp_note_split.sql migration (timestamped filenames sort
// lexicographically). Created by a parallel task — when it does not exist yet
// the SQL assertions below are skipped with an explicit message rather than
// failing this test file.
function newestRsvpNoteSplitMigration(): string | null {
  const matches = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('_rsvp_note_split.sql'))
    .sort();
  return matches.length > 0 ? join(MIGRATIONS_DIR, matches[matches.length - 1]) : null;
}

// The chunk from the LAST `create or replace function <name>` marker (latest
// definition wins) up to the next function marker — same textual-split
// approach as admin-data-layer-coverage.test.ts.
function functionChunk(sql: string, name: string): string | null {
  const marker = /create\s+or\s+replace\s+function\s+(?:[\w"]+\.)?([\w"]+)/gi;
  const starts: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(sql))) {
    starts.push({ name: m[1].replaceAll('"', ''), index: m.index });
  }
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    if (starts[i].name === name) {
      return sql.slice(starts[i].index, starts[i + 1]?.index ?? sql.length);
    }
  }
  return null;
}

const migrationPath = newestRsvpNoteSplitMigration();

describe('rsvp_note split migration keeps guests.note out of the RPCs', () => {
  if (!migrationPath) {
    it.skip('supabase/migrations/*_rsvp_note_split.sql not found — it is created by a parallel task; SQL assertions skipped until it lands', () => {});
    return;
  }
  const sql = readFileSync(migrationPath, 'utf8');

  it('get_rsvp_by_token does not project g.note', () => {
    const chunk = functionChunk(sql, 'get_rsvp_by_token');
    expect(chunk, 'migration must (re)define get_rsvp_by_token').not.toBeNull();
    expect(chunk).not.toMatch(/\bg\.note\b/);
  });

  it('submit_rsvp does not assign the owner-internal note column', () => {
    const chunk = functionChunk(sql, 'submit_rsvp');
    expect(chunk, 'migration must (re)define submit_rsvp').not.toBeNull();
    // `\bnote` cannot match inside `rsvp_note`, so `rsvp_note = _note_n` (the
    // intended write) passes while `note = _note_n` (the leak) fails.
    expect(chunk).not.toMatch(/\bnote\s*=\s*_note_n\b/);
  });
});

// Feature 3 ("who's coming" opt-in, guest-features-natalie-learnings.md)
// tripwire: get_event_attendees_public exposes ONLY first names of OTHER
// attending, opted-in guests. It must never select phone / note / rsvp_note /
// meal_pref / contact_id, and must never surface a non-attending guest.
const WHO_S_COMING_MIGRATION = join(
  MIGRATIONS_DIR,
  '20260712174141_who_s_coming_opt_in.sql',
);
const FORBIDDEN_COLUMNS =
  /\bog\.(?:phone|note|rsvp_note|meal_pref|contact_id)\b/;

describe('get_event_attendees_public exposes first names only', () => {
  const sql = readFileSync(WHO_S_COMING_MIGRATION, 'utf8');
  const chunk = functionChunk(sql, 'get_event_attendees_public');

  it('the migration (re)defines get_event_attendees_public', () => {
    expect(chunk).not.toBeNull();
  });

  it('never selects phone/note/rsvp_note/meal_pref/contact_id of the other guest', () => {
    expect(chunk).not.toMatch(FORBIDDEN_COLUMNS);
  });

  it('only builds a first_name field (derived in SQL via split_part)', () => {
    expect(chunk).toMatch(/split_part\(\s*btrim\(og\.full_name\)/);
    expect(chunk).toMatch(/'first_name'/);
  });

  it('filters the other guest to status = attending AND show_in_guest_list = true', () => {
    expect(chunk).toMatch(/og\.status\s*=\s*'attending'/);
    expect(chunk).toMatch(/og\.show_in_guest_list\s*=\s*true/);
  });

  it('scopes to the caller token, non-revoked, and an active event', () => {
    expect(chunk).toMatch(/g\.rsvp_token\s*=\s*_token/);
    expect(chunk).toMatch(/g\.rsvp_token_revoked_at\s+is\s+null/);
    expect(chunk).toMatch(/e\.status\s*=\s*'active'/);
  });

  it('is granted to service_role only (revoked from public/anon/authenticated)', () => {
    expect(sql).toMatch(
      /revoke all on function public\.get_event_attendees_public\(text\) from public/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.get_event_attendees_public\(text\) from anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_event_attendees_public\(text\) to service_role/,
    );
  });
});

describe('submit_rsvp forces show_in_guest_list false for non-attending guests', () => {
  const sql = readFileSync(WHO_S_COMING_MIGRATION, 'utf8');
  const chunk = functionChunk(sql, 'submit_rsvp');

  it('the migration (re)defines submit_rsvp with the new _show_in_list param', () => {
    expect(chunk).not.toBeNull();
    expect(chunk).toMatch(/_show_in_list\s+boolean\s+default\s+false/);
  });

  it('assigns show_in_guest_list from the normalized, not raw, input', () => {
    expect(chunk).toMatch(/show_in_guest_list\s*=\s*_show_list_n/);
  });
});
