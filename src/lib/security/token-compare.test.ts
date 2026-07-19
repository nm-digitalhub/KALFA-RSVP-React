import { describe, expect, it } from 'vitest';

import { safeTokenEqual, sha256Hex } from './token-compare';

describe('sha256Hex', () => {
  it('produces the known SHA-256 of a fixed input', () => {
    // Independently verifiable: echo -n 'abc' | sha256sum
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('safeTokenEqual', () => {
  const token = 'a'.repeat(32);
  const hash = sha256Hex(token);

  it('accepts the exact token against its stored hash', () => {
    expect(safeTokenEqual(token, hash)).toBe(true);
  });

  it('accepts an uppercase stored hash (hex case-insensitive)', () => {
    expect(safeTokenEqual(token, hash.toUpperCase())).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    expect(safeTokenEqual('b'.repeat(32), hash)).toBe(false);
  });

  it('rejects tokens of different lengths without throwing', () => {
    expect(safeTokenEqual('short', hash)).toBe(false);
    expect(safeTokenEqual(token + 'x', hash)).toBe(false);
  });

  it('fails closed on missing/malformed stored hashes', () => {
    expect(safeTokenEqual(token, null)).toBe(false);
    expect(safeTokenEqual(token, undefined)).toBe(false);
    expect(safeTokenEqual(token, '')).toBe(false);
    expect(safeTokenEqual(token, 'not-hex')).toBe(false);
    expect(safeTokenEqual(token, hash.slice(0, 63))).toBe(false); // truncated
  });

  it('rejects the empty presented token (still without throwing)', () => {
    expect(safeTokenEqual('', hash)).toBe(false);
  });
});
