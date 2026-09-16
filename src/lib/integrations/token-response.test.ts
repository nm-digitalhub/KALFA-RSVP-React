import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type {
  TokenEndpointResponse,
  TokenEndpointResponseHelpers,
} from 'openid-client';

import { parseOAuthCredentialSecret } from './credential-secret';
import {
  normalizeTokenResponse,
  parseScope,
  type GrantTokenResponse,
} from './token-response';

const NOW = Date.parse('2026-09-16T12:00:00.000Z');

// The normalizer declares its input structurally instead of importing the
// library's type (see the note on GrantTokenResponse). This is what keeps that
// from drifting: what every grant in openid-client actually resolves to must
// remain assignable to what the normalizer accepts. A field renamed or narrowed
// upstream fails HERE, at build time, rather than at the first real callback.
const _libraryShapeStillFits: GrantTokenResponse = {} as TokenEndpointResponse &
  TokenEndpointResponseHelpers;
void _libraryShapeStillFits;

function tokens(overrides: Partial<GrantTokenResponse> = {}): GrantTokenResponse {
  return {
    access_token: 'access-1',
    token_type: 'bearer',
    ...overrides,
  } as GrantTokenResponse;
}

describe('what the connection stores as granted scopes', () => {
  it('takes the server’s answer when it gives one', () => {
    const result = normalizeTokenResponse({
      tokens: tokens({ scope: 'Mail.Send Mail.Read' }),
      requestedAccessScopes: ['Mail.Send', 'Calendars.ReadWrite'],
      nowMs: NOW,
    });

    expect(result.accessScopes).toEqual(['Mail.Send', 'Mail.Read']);
  });

  it('records the NARROWED set when the user unticked a scope at the consent screen', () => {
    // Google lets a user deselect individual scopes. RFC 6749 §3.3 obliges the
    // server to send `scope` when the grant differs — so this is the case the
    // runtime check exists for, and inheriting the request would erase it.
    const result = normalizeTokenResponse({
      tokens: tokens({ scope: 'Mail.Send' }),
      requestedAccessScopes: ['Mail.Send', 'Calendars.ReadWrite'],
      nowMs: NOW,
    });

    expect(result.accessScopes).toEqual(['Mail.Send']);
    expect(result.accessScopes).not.toContain('Calendars.ReadWrite');
  });

  it('falls back to the requested set when the server stays silent', () => {
    // §5.1: `scope` is optional only when identical to what was asked for.
    const result = normalizeTokenResponse({
      tokens: tokens(),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.accessScopes).toEqual(['Mail.Send']);
  });

  it('copies the fallback rather than aliasing the caller’s array', () => {
    const requested = ['Mail.Send'];
    const result = normalizeTokenResponse({
      tokens: tokens(),
      requestedAccessScopes: requested,
      nowMs: NOW,
    });

    result.accessScopes.push('Injected.Scope');
    expect(requested).toEqual(['Mail.Send']);
  });

  it('never invents an access scope from a request-only scope', () => {
    // `offline_access` buys a refresh token, not a permission, and Microsoft
    // does not report it as granted. A caller that wrongly passed it in would
    // still only get back what it passed — the guard that matters is that
    // `capabilities` never lists it, which provider.test.ts covers.
    const result = normalizeTokenResponse({
      tokens: tokens({ scope: 'Mail.Send', refresh_token: 'refresh-1' }),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.accessScopes).toEqual(['Mail.Send']);
  });
});

describe('what happens to the refresh token', () => {
  it('keeps the one already held when the server rotates nothing', () => {
    // RFC 6749 §6 lets a server return no refresh token at all; Google returns
    // one only on the first authorization. Dropping it here would end the
    // connection at the next expiry.
    const result = normalizeTokenResponse({
      tokens: tokens(),
      previous: { version: 1, accessToken: 'old-access', refreshToken: 'refresh-old', tokenType: 'Bearer' },
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(parseOAuthCredentialSecret(result.secret).refreshToken).toBe('refresh-old');
  });

  it('discards the old one as soon as the server issues a new one', () => {
    // §6: "the client MUST discard the old refresh token and replace it".
    const result = normalizeTokenResponse({
      tokens: tokens({ refresh_token: 'refresh-new' }),
      previous: { version: 1, accessToken: 'old-access', refreshToken: 'refresh-old', tokenType: 'Bearer' },
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(parseOAuthCredentialSecret(result.secret).refreshToken).toBe('refresh-new');
  });

  it('treats an empty rotation as no rotation', () => {
    const result = normalizeTokenResponse({
      tokens: tokens({ refresh_token: '   ' }),
      previous: { version: 1, accessToken: 'old-access', refreshToken: 'refresh-old', tokenType: 'Bearer' },
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(parseOAuthCredentialSecret(result.secret).refreshToken).toBe('refresh-old');
  });

  it('stores none when there never was one', () => {
    const result = normalizeTokenResponse({
      tokens: tokens(),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(parseOAuthCredentialSecret(result.secret).refreshToken).toBeUndefined();
  });
});

describe('when the access token expires', () => {
  it('derives an absolute timestamp from the helper', () => {
    const result = normalizeTokenResponse({
      tokens: tokens({ expires_in: 3599, expiresIn: () => 3599 }),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.expiresAt).toBe('2026-09-16T12:59:59.000Z');
  });

  it('prefers the helper over the raw field, because it has already elapsed', () => {
    // `expiresIn()` subtracts the time spent in transit; `expires_in` does not.
    const result = normalizeTokenResponse({
      tokens: tokens({ expires_in: 3599, expiresIn: () => 3000 }),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.expiresAt).toBe('2026-09-16T12:50:00.000Z');
  });

  it('reads the raw field when no helper is attached', () => {
    const result = normalizeTokenResponse({
      tokens: tokens({ expires_in: 60 }),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.expiresAt).toBe('2026-09-16T12:01:00.000Z');
  });

  it('⚠️ stores null when the server did not say — not a default', () => {
    // `expires_in` is RECOMMENDED, not REQUIRED. Inventing a lifetime here is
    // the guess openid-client and n8n both refuse to make, on strictly more
    // information than we hold.
    const result = normalizeTokenResponse({
      tokens: tokens(),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.expiresAt).toBeNull();
  });

  it('⚠️ keeps an already-expired token as a PAST timestamp, never null', () => {
    // `expiresIn()` answers 0 for a token that is already dead. That is
    // knowledge, and null means silence — collapsing the two would send a
    // known-dead token out to earn a 401 instead of refusing it up front.
    const result = normalizeTokenResponse({
      tokens: tokens({ expiresIn: () => 0 }),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.expiresAt).toBe('2026-09-16T12:00:00.000Z');
  });

  it('refuses a nonsensical lifetime rather than dating the token in the past', () => {
    const result = normalizeTokenResponse({
      tokens: tokens({ expires_in: -60 }),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(result.expiresAt).toBeNull();
  });
});

describe('what it refuses outright', () => {
  it('rejects a response with no access token', () => {
    expect(() =>
      normalizeTokenResponse({
        tokens: tokens({ access_token: '   ' }),
        requestedAccessScopes: ['Mail.Send'],
        nowMs: NOW,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'integration_token_response_invalid',
        classification: 'permanent',
      }),
    );
  });

  it('rejects a token type this runtime cannot attach', () => {
    // openid-client lowercases `token_type`; anything but bearer would be
    // attached wrongly by the `bearer` presentation.
    expect(() =>
      normalizeTokenResponse({
        tokens: tokens({ token_type: 'dpop' as GrantTokenResponse['token_type'] }),
        requestedAccessScopes: ['Mail.Send'],
        nowMs: NOW,
      }),
    ).toThrowError(expect.objectContaining({ code: 'integration_credential_invalid' }));
  });

  it('accepts the lowercased token_type the library always produces', () => {
    const result = normalizeTokenResponse({
      tokens: tokens({ token_type: 'bearer' }),
      requestedAccessScopes: ['Mail.Send'],
      nowMs: NOW,
    });

    expect(parseOAuthCredentialSecret(result.secret).tokenType).toBe('Bearer');
  });
});

describe('parseScope', () => {
  it('splits on any whitespace run and drops the empties', () => {
    expect(parseScope('  Mail.Send \t Mail.Read\n')).toEqual(['Mail.Send', 'Mail.Read']);
  });

  it('de-duplicates, first occurrence winning', () => {
    expect(parseScope('a b a')).toEqual(['a', 'b']);
  });

  it('is case-sensitive, as §3.3 requires', () => {
    expect(parseScope('Mail.Send mail.send')).toEqual(['Mail.Send', 'mail.send']);
  });
});
