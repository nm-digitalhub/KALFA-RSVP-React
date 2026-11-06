import { describe, expect, it } from 'vitest';

import { getT } from '@/lib/i18n';
import { submitRatingSchema } from './rating';

const schema = submitRatingSchema(getT('public'));

describe('submitRatingSchema', () => {
  it('accepts score 1, 2, or 3 with no comment', () => {
    for (const score of ['1', '2', '3']) {
      const parsed = schema.safeParse({ score, comment: '' });
      expect(parsed.success).toBe(true);
    }
  });

  it('accepts an optional trimmed comment', () => {
    const parsed = schema.safeParse({ score: '3', comment: '  תודה רבה  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.comment).toBe('תודה רבה');
  });

  it('rejects 0, 4, and non-numeric scores', () => {
    for (const score of ['0', '4', 'abc', '']) {
      expect(schema.safeParse({ score, comment: '' }).success).toBe(false);
    }
  });

  it('rejects a comment over 500 chars', () => {
    const parsed = schema.safeParse({ score: '2', comment: 'א'.repeat(501) });
    expect(parsed.success).toBe(false);
  });
});
