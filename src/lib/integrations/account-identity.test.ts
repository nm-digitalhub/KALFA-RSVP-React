import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NO_ACCOUNT_IDENTITY, readAccountIdentity } from './account-identity';

// ⚠️ EVERY ASSERTION HERE GUARDS A SILENT FAILURE. Nothing in this module throws
// and nothing type-errors when it goes wrong: a key built from the wrong claim
// still looks like a key, and a label taken from the wrong claim still renders.
// The damage shows up as two mailboxes that dedup into one, or one that splits
// into two — both weeks later, in a picker nobody can read.

describe('the stable key', () => {
  it('⚠️ is iss AND sub together — never sub alone', () => {
    // OIDC Core §5.7: `sub` is unique "within the Issuer", so a key of `sub`
    // alone is one that two different providers can collide on. The spec calls
    // the PAIR "the only guaranteed unique identifier for a given End-User".
    expect(
      readAccountIdentity({ iss: 'https://login.microsoftonline.com/t/v2.0', sub: 'abc' }).key,
    ).toBe('https://login.microsoftonline.com/t/v2.0 abc');
  });

  it('⚠️ refuses a half-pair rather than inventing one', () => {
    // A key of just the issuer would make EVERY account in a tenant the same
    // account; a key of just the subject would collide across issuers. Both are
    // worse than having no key, which simply means "cannot tell these apart".
    expect(readAccountIdentity({ sub: 'abc' }).key).toBeNull();
    expect(readAccountIdentity({ iss: 'https://example' }).key).toBeNull();
  });

  it('⚠️ is NOT taken from email, which the spec says may be re-used', () => {
    // §5.7 verbatim: "an Issuer MAY re-use an email Claim Value across different
    // End-Users at different points in time". An email-keyed connection would
    // hand a new employee the previous one's mailbox token.
    const identity = readAccountIdentity({ email: 'shared@kalfa.me' });
    expect(identity.key).toBeNull();
    expect(identity.displayName).toBe('shared@kalfa.me');
  });

  it('⚠️ is NOT taken from preferred_username either', () => {
    // §5.1: "The RP MUST NOT rely upon this value being unique."
    expect(readAccountIdentity({ preferred_username: 'netanel@kalfa.me' }).key).toBeNull();
  });
});

describe('the display name', () => {
  it('prefers preferred_username — the claim that exists to be shown', () => {
    expect(
      readAccountIdentity({ preferred_username: 'netanel@kalfa.me', email: 'other@kalfa.me' })
        .displayName,
    ).toBe('netanel@kalfa.me');
  });

  it('falls back to email, which is a worse label but better than none', () => {
    expect(readAccountIdentity({ email: 'netanel@kalfa.me' }).displayName).toBe(
      'netanel@kalfa.me',
    );
  });

  it('⚠️ stays null when the provider said nothing — an empty row is not a label', () => {
    // The normal case for providers that ask for no identity scope. The caller
    // must be able to see the difference and fall back to a provider name.
    expect(readAccountIdentity({ iss: 'https://example', sub: 'abc' }).displayName).toBeNull();
  });
});

describe('what it refuses', () => {
  it('⚠️ rejects non-string claims instead of coercing them', () => {
    // `String({})` is "[object Object]" — a label that renders, and half of a
    // key that compares equal for every such account.
    const identity = readAccountIdentity({
      iss: 42,
      sub: { nested: true },
      preferred_username: ['a'],
      email: null,
    });
    expect(identity).toEqual(NO_ACCOUNT_IDENTITY);
  });

  it('⚠️ rejects whitespace-only claims', () => {
    // A blank label is an unreadable picker row; a blank half of a key silently
    // widens what counts as "the same account".
    expect(readAccountIdentity({ iss: '   ', sub: 'abc', preferred_username: '\t' })).toEqual(
      NO_ACCOUNT_IDENTITY,
    );
  });

  it('trims, so a padded claim is not a different account from the same one', () => {
    expect(readAccountIdentity({ iss: ' https://example ', sub: ' abc ' }).key).toBe(
      'https://example abc',
    );
  });

  it('survives anything that is not a claims object', () => {
    // `claims()` returns `undefined` when no id_token came back — the normal
    // state for a provider we did not ask `openid` of. It must not crash a grant.
    for (const value of [undefined, null, 'claims', 42, []]) {
      expect(readAccountIdentity(value)).toEqual(
        Array.isArray(value) ? { key: null, displayName: null } : NO_ACCOUNT_IDENTITY,
      );
    }
  });
});
