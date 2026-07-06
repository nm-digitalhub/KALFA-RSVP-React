import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Tripwire for the per-event meal-preference toggle (events.show_meal_pref):
// the owner controls whether the public RSVP form collects "העדפת תפריט".
// Textual on purpose (same approach as rsvp-privacy.test.ts) — it fails CI
// loudly if the toggle stops being enforced on either side:
//   * UI  — rsvp-form must gate the field on event.show_meal_pref;
//   * DB  — submit_rsvp must ignore _meal when the toggle is off (a stale or
//           forged client must not write a preference the owner disabled).
// Because this migration REDEFINES both RPCs (newest definition wins over the
// rsvp_note_split one), it also re-asserts the note-privacy invariants from
// rsvp-privacy.test.ts against this newer copy.

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

function newestToggleMigration(): string | null {
  const matches = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('_show_meal_pref_toggle.sql'))
    .sort();
  return matches.length > 0 ? join(MIGRATIONS_DIR, matches[matches.length - 1]) : null;
}

// Same textual splitter as rsvp-privacy.test.ts: the chunk from the LAST
// `create or replace function <name>` marker up to the next marker.
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

describe('meal-preference toggle — app side', () => {
  it('rsvp-form.tsx gates the meal field on event.show_meal_pref (fail-open for a missing key)', () => {
    const source = readFileSync(join(__dirname, 'rsvp-form.tsx'), 'utf8');
    expect(source).toContain('event.show_meal_pref !== false');
  });

  it('the owner edit form posts a show_meal_pref checkbox', () => {
    const source = readFileSync(
      join(ROOT, 'src', 'app', '(customer)', 'app', 'events', '[id]', 'edit-event-form.tsx'),
      'utf8',
    );
    expect(source).toContain('name="show_meal_pref"');
    expect(source).toContain('type="checkbox"');
  });
});

const migrationPath = newestToggleMigration();

describe('show_meal_pref migration — DB side', () => {
  if (!migrationPath) {
    it.skip('supabase/migrations/*_show_meal_pref_toggle.sql not found — SQL assertions skipped', () => {});
    return;
  }
  const sql = readFileSync(migrationPath, 'utf8');

  it('adds the events.show_meal_pref column (default true)', () => {
    expect(sql).toMatch(
      /alter table public\.events add column if not exists show_meal_pref boolean not null default true/,
    );
  });

  it('get_rsvp_by_token projects the toggle to the public payload', () => {
    const chunk = functionChunk(sql, 'get_rsvp_by_token');
    expect(chunk, 'migration must (re)define get_rsvp_by_token').not.toBeNull();
    expect(chunk).toContain("'show_meal_pref', e.show_meal_pref");
  });

  it('submit_rsvp writes _meal_n only behind the _e.show_meal_pref guard', () => {
    const chunk = functionChunk(sql, 'submit_rsvp');
    expect(chunk, 'migration must (re)define submit_rsvp').not.toBeNull();
    expect(chunk).toContain('_e.show_meal_pref');
    // The pre-toggle unconditional assignment must be gone.
    expect(chunk).not.toContain("_meal_n := nullif(btrim(_meal), '');");
  });

  // This migration now holds the NEWEST definitions of both RPCs — re-assert
  // the guests.note privacy invariants (finding B-2) against it.
  it('the redefined RPCs still keep the owner-internal guests.note private', () => {
    const getChunk = functionChunk(sql, 'get_rsvp_by_token');
    const submitChunk = functionChunk(sql, 'submit_rsvp');
    expect(getChunk).not.toMatch(/\bg\.note\b/);
    expect(submitChunk).not.toMatch(/\bnote\s*=\s*_note_n\b/);
  });
});
