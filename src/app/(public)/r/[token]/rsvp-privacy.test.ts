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
