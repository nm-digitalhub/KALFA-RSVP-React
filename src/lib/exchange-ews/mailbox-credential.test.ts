import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const decryptCredential = vi.fn(() => 'the-mailbox-password');
vi.mock('@/lib/exchange-ews/crypto', () => ({ decryptCredential }));

const { resolveMailboxPassword } = await import('@/lib/exchange-ews/mailbox-credential');

const ENCRYPTED = { ciphertext: 'c', iv: 'i', authTag: 't', keyVersion: 1 };
const original = process.env.EXCHANGE_PROVIDER;

beforeEach(() => decryptCredential.mockClear());
afterEach(() => {
  if (original === undefined) delete process.env.EXCHANGE_PROVIDER;
  else process.env.EXCHANGE_PROVIDER = original;
});

describe('resolveMailboxPassword', () => {
  // The whole point: Graph authenticates as the application with a
  // certificate, so a mailbox password is not merely unnecessary — decrypting
  // one put a live secret in memory every scheduled tick and let a failure
  // that had nothing to do with Graph abort a Graph call.
  it.each([
    ['graph explicitly', 'graph'],
    ['unset (graph is the default)', undefined],
    ['the kill switch', 'off'],
    ['an unrecognised value, which falls back to graph', 'nonsense'],
  ])('returns empty and never decrypts under %s', (_label, value) => {
    if (value === undefined) delete process.env.EXCHANGE_PROVIDER;
    else process.env.EXCHANGE_PROVIDER = value;

    expect(resolveMailboxPassword(ENCRYPTED, 'conn-1', 'user-1')).toBe('');
    expect(decryptCredential).not.toHaveBeenCalled();
  });

  it('decrypts under ews, where NTLM genuinely needs the password', () => {
    process.env.EXCHANGE_PROVIDER = 'ews';
    expect(resolveMailboxPassword(ENCRYPTED, 'conn-1', 'user-1')).toBe('the-mailbox-password');
    expect(decryptCredential).toHaveBeenCalledWith(ENCRYPTED, 'conn-1', 'user-1');
  });

  // Callers wrap this in try/catch and fail closed. That must keep working for
  // the one provider that actually depends on the credential.
  it('still throws under ews when the credential cannot be decrypted', () => {
    process.env.EXCHANGE_PROVIDER = 'ews';
    decryptCredential.mockImplementationOnce(() => {
      throw new Error('bad key');
    });
    expect(() => resolveMailboxPassword(ENCRYPTED, 'conn-1', 'user-1')).toThrow('bad key');
  });

  it('reads the env per call, so a restart picks up a changed provider', () => {
    process.env.EXCHANGE_PROVIDER = 'ews';
    expect(resolveMailboxPassword(ENCRYPTED, 'c', 'u')).toBe('the-mailbox-password');
    process.env.EXCHANGE_PROVIDER = 'graph';
    expect(resolveMailboxPassword(ENCRYPTED, 'c', 'u')).toBe('');
  });
  // The columns became nullable in §B phase 1: under Graph a connection has no
  // mailbox secret to store, and the old NOT NULL made every row carry one that
  // authenticated nothing. These pin what "absent" now means per provider.
  describe('when the connection stores no credential', () => {
    const EMPTY = { ciphertext: null, iv: null, authTag: null, keyVersion: 1 };

    it('is a non-event under graph — nothing needed it', () => {
      delete process.env.EXCHANGE_PROVIDER;
      expect(resolveMailboxPassword(EMPTY, 'conn-1', 'user-1')).toBe('');
      expect(decryptCredential).not.toHaveBeenCalled();
    });

    // NTLM cannot authenticate without a password. Throwing surfaces it exactly
    // where a decrypt failure would, and every caller already fails closed
    // there — the alternative is calling the mailbox with an empty password and
    // reading the rejection back as a mysterious auth error.
    it('throws under ews rather than attempting an empty password', () => {
      process.env.EXCHANGE_PROVIDER = 'ews';
      expect(() => resolveMailboxPassword(EMPTY, 'conn-1', 'user-1')).toThrow(
        /stores no credential/,
      );
      expect(decryptCredential).not.toHaveBeenCalled();
    });

    // A DB constraint keeps the three columns all-present or all-absent, but the
    // types are independently nullable, so a partial shape must not reach the
    // decrypter and fail there instead.
    it('rejects a half-present credential under ews', () => {
      process.env.EXCHANGE_PROVIDER = 'ews';
      expect(() =>
        resolveMailboxPassword({ ciphertext: 'c', iv: null, authTag: 't', keyVersion: 1 }, 'c', 'u'),
      ).toThrow(/stores no credential/);
      expect(decryptCredential).not.toHaveBeenCalled();
    });
  });

});
