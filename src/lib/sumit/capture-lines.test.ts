import { describe, expect, it, vi } from 'vitest';

// capture.ts is 'server-only'; same stub the sibling capture.test.ts uses.
vi.mock('server-only', () => ({}));

import { linesReconcile, type SumitChargeLine } from './capture';

// SUMIT charges the SUM OF THE Items ROWS and ignores the `amount` we pass, so
// an itemised receipt is only safe while the rows reconcile exactly to the
// amount this system computed, recorded and showed the customer. This suite
// pins that boundary: everything that does not reconcile must fall back to the
// single line rather than charge a number nobody computed.

const line = (name: string, quantity: number, unitPrice: number): SumitChargeLine => ({
  name,
  quantity,
  unitPrice,
});

describe('linesReconcile — the itemised receipt is used only when it adds up', () => {
  it('accepts the plain two-row case: activation fee + overage', () => {
    // 200 + 10 × 4 = 240
    expect(
      linesReconcile([line('דמי הפעלה', 1, 200), line('אנשי קשר', 10, 4)], 240),
    ).toBe(true);
  });

  it('accepts a credit as a single negative row', () => {
    // 200 + 10 × 4 − 90 = 150 (the case SUMIT support confirmed)
    expect(
      linesReconcile(
        [line('דמי הפעלה', 1, 200), line('אנשי קשר', 10, 4), line('קרדיט', 1, -90)],
        150,
      ),
    ).toBe(true);
  });

  it('accepts the activation fee alone', () => {
    expect(linesReconcile([line('דמי הפעלה', 1, 200)], 200)).toBe(true);
  });

  it('reconciles at agora precision, not floating-point identity', () => {
    // 3 × 4.1 = 12.299999999999999 in IEEE-754; the receipt says 12.30.
    expect(linesReconcile([line('אנשי קשר', 3, 4.1)], 12.3)).toBe(true);
  });

  // --- everything below must fall back to the single line -------------------

  it('rejects rows that do not sum to the amount — the whole point', () => {
    expect(
      linesReconcile([line('דמי הפעלה', 1, 200), line('אנשי קשר', 10, 4)], 200),
    ).toBe(false);
  });

  it('rejects a breakdown that is short by one agora', () => {
    expect(linesReconcile([line('דמי הפעלה', 1, 199.99)], 200)).toBe(false);
  });

  it('rejects MORE than one negative row', () => {
    // Two negatives can net a malformed charge row back to a plausible total,
    // which is exactly the class of error the sum check cannot see.
    expect(
      linesReconcile(
        [line('דמי הפעלה', 1, 300), line('קרדיט', 1, -100), line('עוד קרדיט', 1, -50)],
        150,
      ),
    ).toBe(false);
  });

  it('rejects a zero-price row', () => {
    expect(
      linesReconcile([line('דמי הפעלה', 1, 200), line('חינם', 1, 0)], 200),
    ).toBe(false);
  });

  it('rejects a negative quantity — a discount must be a negative PRICE', () => {
    expect(
      linesReconcile([line('דמי הפעלה', 1, 200), line('קרדיט', -1, 50)], 150),
    ).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(linesReconcile([line('שבור', 1, Number.NaN)], 200)).toBe(false);
    expect(linesReconcile([line('שבור', Number.POSITIVE_INFINITY, 1)], 200)).toBe(false);
  });

  it('rejects a non-positive total — a ₪0 charge never reaches SUMIT at all', () => {
    expect(linesReconcile([line('דמי הפעלה', 1, 200), line('קרדיט', 1, -200)], 0)).toBe(
      false,
    );
  });

  it('rejects an empty or absent breakdown', () => {
    expect(linesReconcile([], 200)).toBe(false);
    expect(linesReconcile(undefined, 200)).toBe(false);
  });

  it('rejects a NaN amount rather than matching a NaN sum', () => {
    expect(linesReconcile([line('דמי הפעלה', 1, 200)], Number.NaN)).toBe(false);
  });
});
