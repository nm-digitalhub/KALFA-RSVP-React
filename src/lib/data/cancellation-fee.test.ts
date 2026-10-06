import { describe, expect, it } from 'vitest';

import { cancellationFeeBase, feeFromPercent } from './cancellation-fee';

describe('cancellationFeeBase', () => {
  it('a charged campaign: the base is what was charged', () => {
    expect(cancellationFeeBase({ chargeStatus: 'charged', finalChargeAmount: 300, maxChargeCeiling: 999 })).toBe(300);
  });
  it('a campaign not yet charged: the base is the frozen ceiling', () => {
    expect(cancellationFeeBase({ chargeStatus: null, finalChargeAmount: 0, maxChargeCeiling: 400 })).toBe(400);
    expect(cancellationFeeBase({ chargeStatus: 'charge_failed', finalChargeAmount: null, maxChargeCeiling: 400 })).toBe(400);
  });
  it.each([
    ['no ceiling', { chargeStatus: null, finalChargeAmount: 0, maxChargeCeiling: null }],
    ['a zero ceiling', { chargeStatus: null, finalChargeAmount: 0, maxChargeCeiling: 0 }],
    ['charged down to nothing', { chargeStatus: 'charged', finalChargeAmount: 0, maxChargeCeiling: 400 }],
    ['an unreadable charge', { chargeStatus: 'charged', finalChargeAmount: null, maxChargeCeiling: 400 }],
    ['a base that is not a number', { chargeStatus: null, finalChargeAmount: 0, maxChargeCeiling: Number.NaN }],
  ])('%s: no base (0), so no percentage can be applied', (_name, c) => {
    expect(cancellationFeeBase(c)).toBe(0);
  });
});

describe('cancellationFeeBase — a fixed-price package', () => {
  it('the base is what the card paid, whatever the old campaign columns say', () => {
    expect(
      cancellationFeeBase({ chargeStatus: null, finalChargeAmount: 0, maxChargeCeiling: 999, packagePaid: 120 }),
    ).toBe(120);
    expect(
      cancellationFeeBase({ chargeStatus: 'charged', finalChargeAmount: 300, maxChargeCeiling: 999, packagePaid: 120 }),
    ).toBe(120);
  });
  it('a package with nothing left paid has no base', () => {
    expect(cancellationFeeBase({ chargeStatus: null, finalChargeAmount: 0, maxChargeCeiling: null, packagePaid: 0 })).toBe(0);
  });
  it('packagePaid null / absent means "not a package": the old rules apply', () => {
    expect(cancellationFeeBase({ chargeStatus: null, finalChargeAmount: 0, maxChargeCeiling: 400, packagePaid: null })).toBe(400);
  });
});

describe('feeFromPercent', () => {
  it('turns a percentage into whole agorot, rounded half up', () => {
    expect(feeFromPercent(300, 5)).toBe(15);
    expect(feeFromPercent(84, 12.5)).toBe(10.5);
    expect(feeFromPercent(84, 5)).toBe(4.2);
    expect(feeFromPercent(100, 33.333)).toBe(33.33);
  });
  it('a percentage that comes to less than an agora is nothing', () => {
    expect(feeFromPercent(0.1, 1)).toBe(0);
  });
  it('100% of a base is the base', () => {
    expect(feeFromPercent(84, 100)).toBe(84);
  });
});
