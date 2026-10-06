import { describe, expect, it } from 'vitest';

import { journeyRank } from './journey-order';

describe('journeyRank', () => {
  it('orders the steps the way a guest meets them', () => {
    const keys = ['final', 'thankyou', 'invite', 'reminder_2', 'reminder_1'];
    expect([...keys].sort((a, b) => journeyRank(a) - journeyRank(b))).toEqual(['invite', 'reminder_1', 'reminder_2', 'final', 'thankyou']);
  });

  it('puts a step it does not know after every known one', () => {
    expect(journeyRank('brand_new_step')).toBeGreaterThan(journeyRank('thankyou'));
  });
});
