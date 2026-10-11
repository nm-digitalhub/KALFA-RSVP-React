import { describe, expect, it } from 'vitest';

import { allowedTestDestination, testNumberAllowlist } from './test-numbers';

describe('test-number allowlist', () => {
  it('normalizes each entry and drops what does not parse', () => {
    expect([...testNumberAllowlist(' 050-1234567 , +972521112222, nonsense ,')]).toEqual([
      '+972501234567',
      '+972521112222',
    ]);
  });

  it('an empty or missing list allows nothing', () => {
    expect(testNumberAllowlist('').size).toBe(0);
    expect(testNumberAllowlist(undefined).size).toBe(0);
    expect(allowedTestDestination('0501234567', new Set())).toBeNull();
  });

  it('allows a listed number in any written form, and nothing else', () => {
    const list = testNumberAllowlist('+972501234567');
    expect(allowedTestDestination('050-123-4567', list)).toBe('+972501234567');
    expect(allowedTestDestination('0509999999', list)).toBeNull();
  });
});
