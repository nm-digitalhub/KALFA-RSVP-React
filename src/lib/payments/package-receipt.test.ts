import { describe, expect, it } from 'vitest';

import { RECEIPT_DESCRIPTION, receiptLineFor } from './package-receipt';

describe('receiptLineFor', () => {
  it('is the purchased package\'s own name', () => {
    expect(receiptLineFor('  אישורי הגעה — וואטסאפ + שיחות AI ')).toBe('אישורי הגעה — וואטסאפ + שיחות AI');
  });

  it.each([
    ['no package', null],
    ['an empty name', '   '],
    ['a name longer than a product line may be (250)', 'א'.repeat(251)],
  ])('falls back to the general line for %s', (_label, name) => {
    expect(receiptLineFor(name)).toBe(RECEIPT_DESCRIPTION);
  });
});
