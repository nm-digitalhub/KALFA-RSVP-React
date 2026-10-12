import { describe, expect, it } from 'vitest';

import { computeOfferOption } from './pricing';

// The shared discount math (personal-coupons D14): the admin screen's refusal and the assign
// path's frozen option prices both use this, so these tests pin the single convention —
// shekels with agorot precision, discount rounded first, final derived from the rounded discount.

describe('computeOfferOption', () => {
  it('percent of the list price', () => {
    expect(computeOfferOption(100, 'percent', 5)).toEqual({ discountAmount: 5, finalPrice: 95 });
  });

  it('fixed amount off the list price', () => {
    expect(computeOfferOption(200, 'amount', 30)).toEqual({ discountAmount: 30, finalPrice: 170 });
  });

  it('rounds a fractional percent discount to agorot', () => {
    // 5% of ₪95 = ₪4.75 — kept exact at two decimals.
    expect(computeOfferOption(95, 'percent', 5)).toEqual({
      discountAmount: 4.75,
      finalPrice: 90.25,
    });
  });

  it('derives the final price from the ROUNDED discount so list - discount = final holds exactly', () => {
    const { discountAmount, finalPrice } = computeOfferOption(99.99, 'percent', 33.333);
    // raw discount 33.3296…67 → rounded 33.33; final must be 99.99 - 33.33 exactly.
    // The identity is checked in WHOLE AGOROT (integers) — never float addition on the results.
    expect(discountAmount).toBe(33.33);
    expect(finalPrice).toBe(66.66);
    expect(Math.round(discountAmount * 100) + Math.round(finalPrice * 100)).toBe(9999);
  });

  it('computes exactly on a list price binary floats cannot represent (100.50 at 1%)', () => {
    expect(computeOfferOption(100.5, 'percent', 1)).toEqual({
      discountAmount: 1.01,
      finalPrice: 99.49,
    });
  });

  it('owner-pinned cases: 200 at 5% and 200 minus 25', () => {
    expect(computeOfferOption(200, 'percent', 5)).toEqual({ discountAmount: 10, finalPrice: 190 });
    expect(computeOfferOption(200, 'amount', 25)).toEqual({ discountAmount: 25, finalPrice: 175 });
  });

  it('refuses a non-finite input instead of producing NaN money', () => {
    expect(() => computeOfferOption(Number.NaN, 'percent', 5)).toThrow('Invalid pricing input');
    expect(() => computeOfferOption(100, 'amount', Number.POSITIVE_INFINITY)).toThrow(
      'Invalid pricing input',
    );
  });

  it('a 100% discount floors the price at zero (the screen must refuse it)', () => {
    expect(computeOfferOption(100, 'percent', 100).finalPrice).toBe(0);
  });

  it('an amount at or above the list price floors at zero or below', () => {
    expect(computeOfferOption(100, 'amount', 100).finalPrice).toBe(0);
    expect(computeOfferOption(100, 'amount', 150).finalPrice).toBe(-50);
  });
});
