import { describe, expect, it } from 'vitest';

import type { SetValueConfig } from '../nodes/logic-set-value/definition';

import { readString } from './shared';

describe('readString', () => {
  it('reads text and turns anything else into an empty string', () => {
    expect(readString({ value: 'שלום' }, 'value')).toBe('שלום');
    expect(readString({ value: 7 }, 'value')).toBe('');
    expect(readString({}, 'value')).toBe('');
  });

  it('with a config type, reads the same value', () => {
    expect(readString<SetValueConfig>({ value: 'שלום' }, 'value')).toBe('שלום');
  });
});

// Type-level assertions, checked by `tsc --noEmit`. `@ts-expect-error` is the
// inverse of a suppression here: the build FAILS if the error does not occur,
// so each line proves the key check still refuses what it must.
export function _readStringKeyChecks(config: Record<string, unknown>): void {
  // @ts-expect-error — a key SetValueConfig does not declare
  readString<SetValueConfig>(config, 'vale');
  // @ts-expect-error — a key that exists but is not text
  readString<{ count: number }>(config, 'count');
  // Without a type argument any key is allowed, as before.
  readString(config, 'anything');
}
