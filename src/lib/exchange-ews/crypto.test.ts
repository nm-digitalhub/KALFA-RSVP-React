import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CURRENT_ENCRYPTION_KEY_VERSION, decryptCredential, encryptCredential } from './crypto';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const ORIGINAL_KEY = process.env.EXCHANGE_EWS_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.EXCHANGE_EWS_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.EXCHANGE_EWS_ENCRYPTION_KEY;
  else process.env.EXCHANGE_EWS_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe('encryptCredential / decryptCredential', () => {
  it('round-trips the plaintext', () => {
    const enc = encryptCredential('super-secret-password', 'conn-1', 'user-1');
    expect(enc.keyVersion).toBe(CURRENT_ENCRYPTION_KEY_VERSION);
    expect(decryptCredential(enc, 'conn-1', 'user-1')).toBe('super-secret-password');
  });

  it('round-trips an empty AAD-relevant edge case (unicode password)', () => {
    const enc = encryptCredential('סיסמה-בעברית!@#123', 'conn-2', 'user-2');
    expect(decryptCredential(enc, 'conn-2', 'user-2')).toBe('סיסמה-בעברית!@#123');
  });

  it('draws a fresh random IV on every call (never reused)', () => {
    const a = encryptCredential('pw', 'conn-1', 'user-1');
    const b = encryptCredential('pw', 'conn-1', 'user-1');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails closed when the auth tag is tampered with', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    const tampered = { ...enc, authTag: Buffer.alloc(16, 1).toString('base64') };
    expect(() => decryptCredential(tampered, 'conn-1', 'user-1')).toThrow();
  });

  it('fails closed when the IV is tampered with', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    const tampered = { ...enc, iv: Buffer.alloc(12, 2).toString('base64') };
    expect(() => decryptCredential(tampered, 'conn-1', 'user-1')).toThrow();
  });

  it('fails closed when the ciphertext is tampered with', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    const bytes = Buffer.from(enc.ciphertext, 'base64');
    bytes[0] = bytes[0] ^ 0xff;
    const tampered = { ...enc, ciphertext: bytes.toString('base64') };
    expect(() => decryptCredential(tampered, 'conn-1', 'user-1')).toThrow();
  });

  it('fails closed when decrypted under a different connectionId (AAD mismatch)', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    expect(() => decryptCredential(enc, 'conn-2', 'user-1')).toThrow();
  });

  it('fails closed when decrypted under a different userId (AAD mismatch)', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    expect(() => decryptCredential(enc, 'conn-1', 'user-2')).toThrow();
  });

  it('rejects ciphertext foreign to the target record even with a structurally valid envelope', () => {
    // Splice record A's ciphertext into record B's iv/tag envelope and try to
    // decrypt it as B. The GCM auth tag covers ciphertext+AAD together, so
    // this must fail rather than silently returning garbage OR (worse) a
    // plausible-looking wrong plaintext.
    const encA = encryptCredential('pw-a', 'conn-A', 'user-A');
    const encB = encryptCredential('pw-b', 'conn-B', 'user-B');
    const spliced = { ...encB, ciphertext: encA.ciphertext };
    expect(() => decryptCredential(spliced, 'conn-B', 'user-B')).toThrow();
  });

  it('fails closed under the wrong key', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    process.env.EXCHANGE_EWS_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptCredential(enc, 'conn-1', 'user-1')).toThrow();
  });

  it('throws on encrypt when the key is not configured', () => {
    delete process.env.EXCHANGE_EWS_ENCRYPTION_KEY;
    expect(() => encryptCredential('pw', 'conn-1', 'user-1')).toThrow();
  });

  it('throws on encrypt when the key is not 32 bytes', () => {
    process.env.EXCHANGE_EWS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptCredential('pw', 'conn-1', 'user-1')).toThrow();
  });

  it('throws on decrypt when the key is not configured', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    delete process.env.EXCHANGE_EWS_ENCRYPTION_KEY;
    expect(() => decryptCredential(enc, 'conn-1', 'user-1')).toThrow();
  });

  it('rejects an unsupported key version on decrypt (no rotation key configured yet)', () => {
    const enc = encryptCredential('pw', 'conn-1', 'user-1');
    const badVersion = { ...enc, keyVersion: 2 };
    expect(() => decryptCredential(badVersion, 'conn-1', 'user-1')).toThrow();
  });
});
