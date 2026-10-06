import { describe, expect, it } from 'vitest';

import { PURCHASE_ERROR, PURCHASE_ERROR_MESSAGES, purchaseErrorMessage } from './package-purchase-errors';

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
    }
  });

  it('a payment that may or may not have gone through tells the customer NOT to pay again', () => {
    expect(PURCHASE_ERROR_MESSAGES.purchase_review).toContain('אין לשלם שוב');
    expect(PURCHASE_ERROR_MESSAGES.purchase_in_progress).toContain('אין לשלם שוב');
  });
});

describe('purchaseErrorMessage', () => {
  it('maps a known code to its sentence', () => {
    expect(purchaseErrorMessage('purchase_declined')).toBe(PURCHASE_ERROR_MESSAGES.purchase_declined);
  });

  it.each([undefined, '', 'unknown', '__proto__', 'constructor', 'toString', '<script>alert(1)</script>'])(
    'shows nothing for %j — the query string is attacker-controlled and only our own codes select text',
    (code) => {
      expect(purchaseErrorMessage(code)).toBeNull();
    },
  );
});
