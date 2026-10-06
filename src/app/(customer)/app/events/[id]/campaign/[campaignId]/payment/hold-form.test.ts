import { describe, expect, it } from 'vitest';

import { formatCardholderName, FORM_PURPOSE } from './hold-form';

// Card-preview display only — never touches what SUMIT tokenizes or what
// reaches the server. Real embossed cards keep first/last name in full and
// abbreviate middle name(s); matches the convention observed on a real card.
describe('formatCardholderName', () => {
  it('abbreviates a single middle name to 3 letters', () => {
    expect(formatCardholderName('Netanel Mevorach Kalfa')).toBe('NETANEL MEV KALFA');
  });

  it('abbreviates multiple middle names', () => {
    expect(formatCardholderName('Mary Ann Beth O Donnell')).toBe('MARY ANN BET O DONNELL');
  });

  it('leaves a two-part name untouched (first + last only)', () => {
    expect(formatCardholderName('Netanel Kalfa')).toBe('NETANEL KALFA');
  });

  it('leaves a single-word name untouched', () => {
    expect(formatCardholderName('Netanel')).toBe('NETANEL');
  });

  it('uppercases the result', () => {
    expect(formatCardholderName('netanel mevorach kalfa')).toBe('NETANEL MEV KALFA');
  });

  it('collapses extra whitespace between name parts', () => {
    expect(formatCardholderName('  Netanel   Mevorach   Kalfa  ')).toBe('NETANEL MEV KALFA');
  });

  it('handles an empty string', () => {
    expect(formatCardholderName('')).toBe('');
  });
});

// The same card form serves two flows: the legacy card HOLD (authorize route) and the fixed-price package PURCHASE
// (purchase route). What differs is the route it posts to and the words it uses — and the purchase must never talk
// about a "hold" (תפיסה) to a customer who is being charged.
describe('FORM_PURPOSE', () => {
  it('posts a hold to the authorize route and a purchase to the purchase route', () => {
    expect(FORM_PURPOSE.hold.action('c1')).toBe('/api/campaigns/c1/authorize');
    expect(FORM_PURPOSE.purchase.action('c1')).toBe('/api/campaigns/c1/purchase');
  });

  it('keeps the hold wording exactly as it was', () => {
    expect(FORM_PURPOSE.hold.submit).toBe('אישור ותפיסת מסגרת');
    expect(FORM_PURPOSE.hold.dialogTitle).toBe('מאשרים ותופסים את המסגרת');
    expect(FORM_PURPOSE.hold.progressLabel).toBe('התקדמות אישור ותפיסת המסגרת');
    expect(FORM_PURPOSE.hold.placing('₪80')).toBe('תופסים מסגרת אשראי בסך ₪80');
  });

  it('the purchase says it charges, states the amount, and never mentions a hold or the provider', () => {
    const copy = FORM_PURPOSE.purchase;
    expect(copy.placing('₪120')).toContain('₪120');
    for (const text of [copy.submit, copy.dialogTitle, copy.progressLabel, copy.placing('₪120')]) {
      expect(text).not.toContain('תפיסה');
      expect(text).not.toContain('תופס');
      expect(text).not.toMatch(/sumit/i);
    }
  });
});
