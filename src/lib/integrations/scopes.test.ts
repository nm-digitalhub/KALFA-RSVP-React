import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { canonicalScope, grantSatisfies, unsatisfiedScopes } from './scopes';
import { microsoftProvider } from './providers/microsoft';

// ⚠️ THE BUG THIS FILE EXISTS FOR WAS INVISIBLE TO 27 EXISTING FIXTURES, because
// every one of them spelled the scope the same way on both sides of the
// comparison. They agreed with each other; nothing checked them against what
// Microsoft's protocol reference says actually comes back.
//
// So the cases below are written from the DOCUMENTED response shapes, not from
// our own request shape.

const GRAPH = microsoftProvider.oauth.scopeResources ?? [];
const MAIL_SEND = microsoftProvider.capabilities['mail.send'];

describe('reducing a scope to a comparable form', () => {
  it('⚠️ strips a declared resource and lowercases — the documented echo', () => {
    // `v2-oauth2-auth-code-flow` and `v2-oauth2-on-behalf-of-flow` both echo this
    // shape; our capability list spells the same permission `Mail.Send`.
    expect(canonicalScope('https://graph.microsoft.com/mail.send', GRAPH)).toBe('mail.send');
    expect(canonicalScope('Mail.Send', GRAPH)).toBe('mail.send');
  });

  it('tolerates a trailing slash on the declared resource, and whitespace', () => {
    expect(canonicalScope('  https://graph.microsoft.com/Mail.Send ', ['https://graph.microsoft.com/']))
      .toBe('mail.send');
  });

  it('⚠️ leaves an UNDECLARED resource whole — this is the security case', () => {
    // Stripping any `scheme://host/` blindly would let a scope issued for
    // somebody else's API satisfy a Graph capability. A loud
    // `integration_scope_missing` is the better failure.
    expect(canonicalScope('api://someone-else/Mail.Send', GRAPH)).toBe(
      'api://someone-else/mail.send',
    );
    expect(canonicalScope('https://graph.microsoft.us/mail.send', GRAPH)).toBe(
      'https://graph.microsoft.us/mail.send',
    );
  });

  it('never strips on an empty resource list', () => {
    expect(canonicalScope('https://graph.microsoft.com/mail.send', [])).toBe(
      'https://graph.microsoft.com/mail.send',
    );
    // A stray empty string must not turn into the prefix `/`. Asserted on a
    // value that WOULD be affected — the previous version of this case used a
    // scope starting with `https:`, which the mutation could not change either
    // way, so it proved nothing. Caught by fault injection.
    expect(canonicalScope('/mail.send', ['', '   '])).toBe('/mail.send');
    expect(canonicalScope('https://graph.microsoft.com/mail.send', ['', '   '])).toBe(
      'https://graph.microsoft.com/mail.send',
    );
  });
});

describe('does a grant cover a capability', () => {
  it('⚠️ the qualified echo satisfies the short requirement — the whole bug', () => {
    expect(grantSatisfies(['https://graph.microsoft.com/mail.send'], MAIL_SEND, GRAPH)).toBe(true);
  });

  it('the short form satisfies it too — the path taken when `scope` is omitted', () => {
    // Microsoft's reference calls the response `scope` optional; when it is
    // absent, `token-response.ts` stores what we requested, which is this form.
    // Both paths must reach the same verdict, or a connection's health would
    // depend on whether the server felt like echoing.
    expect(grantSatisfies(['Mail.Send'], MAIL_SEND, GRAPH)).toBe(true);
  });

  it('⚠️ a DECLINED scope is still refused — normalising did not weaken the check', () => {
    // The reason the gate exists (credential-accessor.ts): a consent screen that
    // lets a user untick a permission. Nothing here falls back to what we asked
    // for, so an unticked Mail.Send is simply absent.
    expect(grantSatisfies(['https://graph.microsoft.com/mail.read'], MAIL_SEND, GRAPH)).toBe(false);
    expect(grantSatisfies([], MAIL_SEND, GRAPH)).toBe(false);
  });

  it('⚠️ a scope from another resource does not satisfy it', () => {
    expect(grantSatisfies(['api://someone-else/Mail.Send'], MAIL_SEND, GRAPH)).toBe(false);
    expect(grantSatisfies(['https://graph.microsoft.us/mail.send'], MAIL_SEND, GRAPH)).toBe(false);
  });

  it('reports the REQUIRED spelling of a miss, not the canonical one', () => {
    // The message tells an operator which permission to go and grant, so it has
    // to name it the way the consent screen does.
    expect(unsatisfiedScopes(['mail.read'], ['Mail.Send', 'Mail.Read'], GRAPH)).toEqual([
      'Mail.Send',
    ]);
  });

  it('requires ALL of them, not any', () => {
    expect(
      grantSatisfies(['https://graph.microsoft.com/mail.send'], ['Mail.Send', 'Mail.Read'], GRAPH),
    ).toBe(false);
  });

  it('an empty requirement is satisfied by anything, including nothing', () => {
    expect(grantSatisfies([], [], GRAPH)).toBe(true);
  });
});

describe('the Microsoft provider declares what makes this work', () => {
  it('⚠️ names Graph as a scope resource — without it every send fails', () => {
    // Fail-closed: if this field is ever dropped, the runtime goes straight back
    // to comparing `Mail.Send` against `https://graph.microsoft.com/mail.send`.
    expect(microsoftProvider.oauth.scopeResources).toEqual(['https://graph.microsoft.com']);
  });

  it('keeps the capability scope in the request spelling', () => {
    // `scopes-oidc`: omitting the resource identifier defaults it to Graph, so
    // the short form is what we send to `/authorize`.
    expect(MAIL_SEND).toEqual(['Mail.Send']);
  });
});
