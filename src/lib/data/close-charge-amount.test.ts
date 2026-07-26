import { describe, expect, it } from 'vitest';

import { computeChargeAmount } from './close-charge-amount';

const NEW = { base: 200, included: 200, overage: 4, credits: 0 };
// New-model ceiling for a funded set of 300: 200 + max(0, 300-200)*4 = 600.
const NEW_CEILING = 600;

describe('computeChargeAmount — pre-model / pre-S3 campaign (base=0, included=0)', () => {
  // Reduces to pure per-reached; mirrors the live campaigns verified 2026-07-26.
  const OLD = { base: 0, included: 0, overage: 4, credits: 0 };

  it('0 reached → ₪0 (the nothing-to-charge case)', () => {
    expect(computeChargeAmount({ ...OLD, reached: 0, ceiling: 4 }).amount).toBe(0);
  });

  it('reduces exactly to reached × rate (1 → 4, 21 → 84)', () => {
    expect(computeChargeAmount({ ...OLD, reached: 1, ceiling: 4 }).amount).toBe(4);
    expect(computeChargeAmount({ ...OLD, reached: 21, ceiling: 152 }).amount).toBe(84);
  });

  it('caps at the ceiling (old semantics)', () => {
    // 30 reached × 4 = 120, ceiling 100 → capped at 100.
    expect(computeChargeAmount({ ...OLD, reached: 30, ceiling: 100 }).amount).toBe(100);
  });
});

describe('computeChargeAmount — new model (base ₪200, included 200, overage ₪4)', () => {
  it('charges the flat base at or below the included count (0 / 150 / 200 reached → ₪200)', () => {
    expect(computeChargeAmount({ ...NEW, reached: 0, ceiling: NEW_CEILING }).amount).toBe(200);
    expect(computeChargeAmount({ ...NEW, reached: 150, ceiling: NEW_CEILING }).amount).toBe(200);
    expect(computeChargeAmount({ ...NEW, reached: 200, ceiling: NEW_CEILING }).amount).toBe(200);
  });

  it('adds overage only above the included count (201 → ₪204, 300 → ₪600)', () => {
    expect(computeChargeAmount({ ...NEW, reached: 201, ceiling: NEW_CEILING }).amount).toBe(204);
    expect(computeChargeAmount({ ...NEW, reached: 300, ceiling: NEW_CEILING }).amount).toBe(600);
  });

  it('never exceeds the signed ceiling', () => {
    // reached 500 would gross 200 + 300*4 = 1400, but the funded ceiling caps it.
    expect(computeChargeAmount({ ...NEW, reached: 500, ceiling: NEW_CEILING }).amount).toBe(600);
  });
});

describe('computeChargeAmount — credits', () => {
  it('subtracts credits from the capped total and floors at 0', () => {
    // base 200, 0 reached, ₪50 credit → ₪150.
    expect(computeChargeAmount({ ...NEW, reached: 0, ceiling: NEW_CEILING, credits: 50 }).amount).toBe(150);
    // ₪250 credit against a ₪200 base → ₪0, and only ₪200 of the credit is consumed.
    const over = computeChargeAmount({ ...NEW, reached: 0, ceiling: NEW_CEILING, credits: 250 });
    expect(over.amount).toBe(0);
    expect(over.creditApplied).toBe(200);
  });

  it('creditApplied never exceeds the capped total', () => {
    // 204 capped, ₪204 credit → amount 0, creditApplied 204 (all of it consumed).
    const r = computeChargeAmount({ ...NEW, reached: 201, ceiling: NEW_CEILING, credits: 204 });
    expect(r.amount).toBe(0);
    expect(r.creditApplied).toBe(204);
  });
});

describe('computeChargeAmount — agorot rounding', () => {
  it('rounds the final amount to two decimals', () => {
    const r = computeChargeAmount({ base: 0, included: 0, overage: 3.335, reached: 1, ceiling: 100, credits: 0 });
    expect(r.amount).toBe(3.34);
  });
});
