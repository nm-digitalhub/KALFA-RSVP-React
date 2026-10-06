import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sumitStatus } from './status';

describe('sumitStatus', () => {
  it('reads the numeric form the live API returns', () => {
    expect(sumitStatus(0)).toBe('success');
    expect(sumitStatus(1)).toBe('business_error');
    expect(sumitStatus(2)).toBe('technical_error');
  });

  it('reads the string form the vendor OpenAPI declares', () => {
    expect(sumitStatus('Success (0)')).toBe('success');
    expect(sumitStatus('BusinessError (1)')).toBe('business_error');
    expect(sumitStatus('TechnicalError (2)')).toBe('technical_error');
  });

  it('reads the object form, but only where it is unambiguous', () => {
    expect(sumitStatus({ IsError: false })).toBe('success');
    // IsError:true says an error happened, not which kind — and business vs technical
    // decides whether a caller may retry. Guessing is worse than admitting we cannot tell.
    expect(sumitStatus({ IsError: true })).toBe('unknown');
  });

  it('never turns something it does not recognise into success or a decline', () => {
    // For money, "undetermined" is a review. Collapsing it either way is the expensive
    // kind of wrong: one way double-charges, the other way loses a sale silently.
    for (const v of [undefined, null, '', 'Weird', 3, -1, {}, [], true]) {
      expect(sumitStatus(v)).toBe('unknown');
    }
  });
});
