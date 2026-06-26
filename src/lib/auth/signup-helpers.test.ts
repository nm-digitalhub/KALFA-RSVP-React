import { describe, expect, it } from 'vitest';

import { isExistingUserSignup } from './signup-helpers';

describe('isExistingUserSignup', () => {
  it('flags an already-registered email (user present, empty identities)', () => {
    expect(isExistingUserSignup({ user: { identities: [] } })).toBe(true);
  });

  it('does not flag a genuine new signup (user with identities)', () => {
    expect(
      isExistingUserSignup({ user: { identities: [{ id: 'x' }] } }),
    ).toBe(false);
  });

  it('does not flag when there is no user', () => {
    expect(isExistingUserSignup({ user: null })).toBe(false);
  });

  it('does not flag when identities is undefined', () => {
    expect(isExistingUserSignup({ user: {} })).toBe(false);
  });
});
