import { describe, expect, it } from 'vitest';

import { PURCHASE_COPY } from './sumit-card-form';

// The card form charges the package price through the purchase route, and never talks about a "hold" (תפיסה).
describe('PURCHASE_COPY', () => {
  it('posts to the purchase route', () => {
    expect(PURCHASE_COPY.action('c1')).toBe('/api/campaigns/c1/purchase');
  });

  it('says it charges, states the amount, and never mentions a hold or the provider', () => {
    expect(PURCHASE_COPY.placing('₪120')).toContain('₪120');
    for (const text of [PURCHASE_COPY.submit, PURCHASE_COPY.dialogTitle, PURCHASE_COPY.progressLabel, PURCHASE_COPY.placing('₪120')]) {
      expect(text).not.toContain('תפיסה');
      expect(text).not.toContain('תופס');
      expect(text).not.toMatch(/sumit/i);
    }
  });
});
