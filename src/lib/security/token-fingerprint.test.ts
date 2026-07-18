import { describe, expect, it } from 'vitest';

import { tokenFingerprint } from './token-fingerprint';

describe('tokenFingerprint', () => {
  it('is deterministic and 16 lowercase-hex chars', () => {
    const fp = tokenFingerprint('a'.repeat(32));
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(tokenFingerprint('a'.repeat(32))).toBe(fp);
  });

  it('differs across tokens and never contains the raw token', () => {
    const token = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const fp = tokenFingerprint(token);
    expect(fp).not.toBe(tokenFingerprint(token + '1'));
    // The fingerprint must not leak the bearer token itself into bucket keys.
    expect(token.includes(fp)).toBe(false);
    expect(fp.includes(token)).toBe(false);
  });
});
