import { describe, expect, it } from 'vitest';

import { cancellationFeeBase, feeFromPercent } from './cancellation-fee';

describe('cancellationFeeBase', () => {
  it('the base is what the card paid for the package', () => {
    expect(cancellationFeeBase({ packagePaid: 120 })).toBe(120);
  });
  it.each([
    ['a campaign without a package', null],
    ['a package with nothing left paid', 0],
    ['a base that is not a number', Number.NaN],
  ])('%s: no base (0), so no percentage can be applied', (_name, packagePaid) => {
    expect(cancellationFeeBase({ packagePaid })).toBe(0);
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
