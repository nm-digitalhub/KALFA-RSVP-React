import { describe, expect, it } from 'vitest';

import { normalizeGroupName } from './guest-import-shared';

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
