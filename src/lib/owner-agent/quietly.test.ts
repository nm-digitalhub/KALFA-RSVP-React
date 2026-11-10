import { describe, expect, it } from 'vitest';

import { countOf } from './cores/count';
import { quietly } from './quietly';

describe('quietly', () => {
  it('returns the value, or undefined when the step throws', async () => {
    await expect(quietly(async () => 7)).resolves.toBe(7);
    await expect(
      quietly(async () => {
        throw new Error('lost');
      }),
    ).resolves.toBeUndefined();
  });
});

describe('countOf', () => {
  it('returns the count, 0 for a null count, and throws the bare code on an error', () => {
    expect(countOf({ count: 4, error: null }, 'code')).toBe(4);
    expect(countOf({ count: null, error: null }, 'code')).toBe(0);
    expect(() => countOf({ count: 4, error: { message: 'x' } }, 'count_failed')).toThrow('count_failed');
  });
});
