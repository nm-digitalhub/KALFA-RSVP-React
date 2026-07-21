import { describe, expect, it } from 'vitest';

import {
  ALL_CELEBRANT_FIELD_KEYS,
  CELEBRANT_FIELD_KEYS_BY_KIND,
  CELEBRANT_KIND_BY_EVENT_TYPE,
  celebrantsSchemaFor,
  parseCelebrantsForm,
  readCelebrantsForm,
} from '@/lib/validation/schemas';

// Regression guard for a silent data-loss bug: the form reader used to list the
// celebrant field names by hand, in TWO copies (create action + edit action).
// When host_composition was added for the brit flow, the Zod schema, the form
// and the stored shape all gained it and neither reader did — so choosing
// "הרכב המזמינים" posted a value that was dropped before validation. No error
// surfaced anywhere: the select submitted, Zod never saw the key, the parser
// found nothing to store, and reopening the event showed "בחרו…" again.
//
// The reader is now derived from CELEBRANT_FIELD_KEYS_BY_KIND. These tests fail
// if that derivation is ever replaced by a hand-written list that falls behind.

describe('readCelebrantsForm covers the whole celebrant surface', () => {
  it('reads every field any kind declares', () => {
    const declared = [
      ...new Set(Object.values(CELEBRANT_FIELD_KEYS_BY_KIND).flat()),
    ].sort();
    expect([...ALL_CELEBRANT_FIELD_KEYS].sort()).toEqual(declared);

    // And each one is actually pulled off the FormData, under the
    // `celebrants.<key>` name the forms post.
    const form = new FormData();
    for (const key of declared) form.set(`celebrants.${key}`, `v_${key}`);
    const read = readCelebrantsForm(form) as Record<string, unknown>;
    for (const key of declared) {
      expect(read[key], `readCelebrantsForm dropped "${key}"`).toBe(`v_${key}`);
    }
  });

  it('leaves fields the submitted form does not render as undefined', () => {
    const form = new FormData();
    form.set('celebrants.groom', 'חתן');
    const read = readCelebrantsForm(form) as Record<string, unknown>;
    expect(read.groom).toBe('חתן');
    expect(read.host_composition).toBeUndefined();
  });
});

describe('brit: host_composition survives form → schema → stored shape', () => {
  it('keeps the selected composition (the bug: it was dropped)', () => {
    expect(CELEBRANT_KIND_BY_EVENT_TYPE.brit).toBe('parents');

    const form = new FormData();
    form.set('celebrants.parents', 'נטלי קלפה');
    form.set('celebrants.child', '');
    form.set('celebrants.host_composition', 'single_mother');

    const parsed = celebrantsSchemaFor('brit').safeParse(readCelebrantsForm(form));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parseCelebrantsForm('brit', parsed.data)).toEqual({
      parents: 'נטלי קלפה',
      host_composition: 'single_mother',
    });
  });

  it('an unselected composition still stores nothing for it', () => {
    const form = new FormData();
    form.set('celebrants.parents', 'נטלי קלפה');
    form.set('celebrants.host_composition', '');

    const parsed = celebrantsSchemaFor('brit').safeParse(readCelebrantsForm(form));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parseCelebrantsForm('brit', parsed.data)).toEqual({
      parents: 'נטלי קלפה',
    });
  });

  it('a value outside the enum is rejected rather than stored', () => {
    const form = new FormData();
    form.set('celebrants.parents', 'נטלי קלפה');
    form.set('celebrants.host_composition', 'not_a_composition');

    expect(celebrantsSchemaFor('brit').safeParse(readCelebrantsForm(form)).success).toBe(
      false,
    );
  });
});
