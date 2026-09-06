import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// A guest with expected_count NULL is not a cosmetic gap. src/app/(public)/r/
// [token]/rsvp-form.tsx: `const hardCap = guest.expected_count ??
// COUNT_FALLBACK_CAP` — with no invited size the public RSVP form lets a couple
// invited as two confirm fifty. `over_invited` cannot be computed either, and
// the list counts the guest as 1 until they answer.
//
// Lists exported from a venue or a WhatsApp group routinely carry no count
// column at all, so before this every such import produced exactly that state
// with nothing offering to fix it.

const root = process.cwd();
const guestsDir = join(root, 'src', 'app', '(customer)', 'app', 'events', '[id]', 'guests');

const importActions = readFileSync(join(guestsDir, 'import', 'import-actions.ts'), 'utf8');
const importForm = readFileSync(join(guestsDir, 'import', 'import-form.tsx'), 'utf8');
const guestsActions = readFileSync(join(guestsDir, 'guests-actions.ts'), 'utf8');
const guestsPage = readFileSync(join(guestsDir, 'page.tsx'), 'utf8');
const dataLayer = readFileSync(join(root, 'src', 'lib', 'data', 'guests.ts'), 'utf8');

function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n}\n', at) + 1);
}

describe('import: a default count for rows that have none', () => {
  it('the form offers it, and says what happens without one', () => {
    expect(importForm).toContain('name="default_expected_count"');
    expect(importForm).toContain('כמות מוזמנים ברירת מחדל');
    // The consequence, not just the label — this is the whole reason to fill it.
    expect(importForm).toContain('יוכל לאשר הגעה לכל מספר');
  });

  it("the file's own value always wins; the default only fills a blank", () => {
    expect(importActions).toContain(
      "const rawCount = rawFromFile === '' ? defaultCount : rawFromFile;",
    );
  });

  it('validates the default through the same field the rows use', () => {
    // A separate ad-hoc check could accept a value a row would have been
    // rejected for, and the back-fill would then write it to every guest.
    expect(importActions).toContain('importRowSchema.shape.expected_count.safeParse');
  });

  it('an absent default changes nothing — it must not become 0', () => {
    // z.coerce turns '' into 0, which would import every family as "0 מוזמנים".
    // The guard is that a blank default stays blank and the existing
    // `rawCount === ''` branch omits the key entirely.
    expect(importActions).toContain("if (rawDefault !== '')");
    expect(importActions).toContain("...(rawCount === '' ? {} : { expected_count: rawCount })");
  });
});

describe('back-fill: completing what is already missing', () => {
  it('touches only the empty ones', () => {
    const body = bodyOf(dataLayer, 'export async function fillMissingExpectedCount(');
    expect(body).toContain(".is('expected_count', null)");
    // Scoped to the event, and gated — never a bare update by id list.
    expect(body).toContain(".eq('event_id', eventId)");
    expect(body).toContain("requireEventAccess(eventId, 'guests', 'edit')");
    expect(body.indexOf('requireEventAccess')).toBeLessThan(body.indexOf('.update('));
  });

  it('reports the number it actually changed', () => {
    const body = bodyOf(dataLayer, 'export async function fillMissingExpectedCount(');
    expect(body).toContain(".select('id')");
    expect(body).toContain('return data?.length ?? 0');
    // …and the action repeats that number rather than inventing one.
    expect(guestsActions).toContain('הושלמה כמות עבור ${filled.toLocaleString');
  });

  it('validates through the same schema field the guest form uses', () => {
    expect(guestsActions).toContain('createGuestSchema.shape.expected_count.safeParse');
  });

  it('is offered only while guests without a count exist', () => {
    expect(guestsPage).toContain('countGuestsMissingExpectedCount(eventId)');
    expect(guestsPage).toContain('missingExpectedCount > 0 ?');
  });

  it('counts without fetching a page of rows', () => {
    const body = bodyOf(dataLayer, 'export async function countGuestsMissingExpectedCount(');
    expect(body).toContain("{ count: 'exact', head: true }");
  });
});
