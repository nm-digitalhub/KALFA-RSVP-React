import { describe, expect, it } from 'vitest';

import { PURCHASE_ERROR, PURCHASE_ERROR_MESSAGES } from './package-purchase-errors';

describe('package purchase error codes', () => {
  const codes = Object.values(PURCHASE_ERROR);

  it('every code the route can send has a sentence, so the banner is never empty', () => {
    expect(Object.keys(PURCHASE_ERROR_MESSAGES).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(PURCHASE_ERROR_MESSAGES[code].trim().length).toBeGreaterThan(10);
  });

  it('every sentence is Hebrew and names neither the payment provider nor a hold', () => {
    for (const code of codes) {
      const text = PURCHASE_ERROR_MESSAGES[code];
      expect(text, code).toMatch(/[א-ת]/);
      expect(text, code).not.toMatch(/sumit/i);
      expect(text, code).not.toContain('תפיסה');
      // Customer vocabulary (design D8): what was bought is the package, never a "קמפיין".
      expect(text, code).not.toContain('קמפיין');
    }
  });

  it('a 3D Secure failure is never described as the card being declined, and asks for no retyping of a card that was fine', () => {
    for (const code of ['three_ds_timeout', 'three_ds_failed'] as const) {
      const text = PURCHASE_ERROR_MESSAGES[code];
      expect(text, code).toContain('3D Secure');
      expect(text, code).not.toContain('נדחה');
      expect(text, code).not.toContain('בדקו את פרטי הכרטיס');
    }
  });

  it('a payment that may or may not have gone through tells the customer NOT to pay again', () => {
    expect(PURCHASE_ERROR_MESSAGES.purchase_review).toContain('אין לשלם שוב');
    expect(PURCHASE_ERROR_MESSAGES.purchase_in_progress).toContain('אין לשלם שוב');
  });
});
