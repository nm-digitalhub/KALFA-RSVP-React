import { describe, expect, it } from 'vitest';

import { normalizeGroupName, normalizeGuestName } from './guest-import-shared';

describe('normalizeGroupName', () => {
  it('trims and collapses inner whitespace to a single space', () => {
    expect(normalizeGroupName('  משפחה   קרובה ')).toBe('משפחה קרובה');
    expect(normalizeGroupName('משפחת\tקלפה')).toBe('משפחת קלפה');
  });

  it('keeps an already-normal name unchanged', () => {
    expect(normalizeGroupName('עבודה')).toBe('עבודה');
  });

  it('matches the DB index normalization semantics (case handled by callers)', () => {
    // Two visually-identical spellings collapse to the same comparison key.
    const key = (s: string) => normalizeGroupName(s).toLowerCase();
    expect(key('Family  Cohen')).toBe(key(' family cohen '));
  });
});

describe('normalizeGuestName', () => {
  it('treats the Hebrew geresh and an ASCII apostrophe as the SAME name (the live bug)', () => {
    const apostrophe = "ג'קלין ושלמה טויטו"; // U+0027
    const geresh = 'ג׳קלין ושלמה טויטו'; // U+05F3
    expect(apostrophe).not.toBe(geresh); // byte-different on purpose
    expect(normalizeGuestName(apostrophe)).toBe(normalizeGuestName(geresh));
  });

  it('unifies gershayim with an ASCII quote', () => {
    expect(normalizeGuestName('צה״ל')).toBe(normalizeGuestName('צה"ל'));
  });

  it('collapses whitespace and strips niqqud + bidi marks', () => {
    expect(normalizeGuestName('  שָׁלוֹם   כֹּהֵן ')).toBe('שלום כהן');
    expect(normalizeGuestName('‏דנה לוי‎')).toBe('דנה לוי');
  });

  it('lowercases Latin names so casing never splits a match', () => {
    expect(normalizeGuestName('Jane DOE')).toBe(normalizeGuestName('jane doe'));
  });

  it('keeps genuinely different names distinct', () => {
    expect(normalizeGuestName('דוד כהן')).not.toBe(normalizeGuestName('דוד לוי'));
  });
});
