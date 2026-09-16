import 'server-only';

import {
  serializeOAuthCredentialSecret,
  type OAuthCredentialSecret,
} from './credential-secret';
import { IntegrationRuntimeError } from './errors';

/**
 * Exactly the fields this module reads — declared structurally rather than
 * imported from the OAuth library.
 *
 * Two reasons, and the second is the one that forced it. A pure normalizer
 * should not take a dependency on a vendored type surface it does not need. And
 * the library's response type carries an index signature of
 * `JsonValue | undefined`, so a HELPER METHOD cannot coexist with it inside a
 * `Partial<>` — a test fixture could not be written without a cast that would
 * also silence a misspelt field name.
 *
 * `token_type` is `string` here and `Lowercase<string>` there, which is the
 * safe direction: the library's shape is assignable to this one, and
 * `token-response.test.ts` asserts that at the type level so the widening
 * cannot silently drift into a real divergence.
 */
export type GrantTokenResponse = {
  readonly access_token: string;
  readonly token_type: string;
  readonly refresh_token?: string;
  readonly scope?: string;
  readonly expires_in?: number;
  /** `TokenEndpointResponseHelpers.expiresIn` — present on every grant result. */
  readonly expiresIn?: () => number | undefined;
};

export type NormalizeTokenResponseInput = {
  tokens: GrantTokenResponse;

  /**
   * The credential this one replaces, on a refresh. Supplies the refresh token
   * to keep when the server does not return a new one.
   */
  previous?: OAuthCredentialSecret;

  /**
   * What to record as granted when the server omits `scope`.
   *
   * ⚠️ THE TWO CALLERS PASS DIFFERENT THINGS, AND THAT IS THE POINT.
   *
   *   callback — the union of the selected capabilities' scopes. It is the
   *              first grant, so there is nothing earlier to inherit.
   *   refresh  — `integration_connections.scopes`, the PREVIOUSLY GRANTED set,
   *              never the originally requested one. RFC 6749 §6: a refresh
   *              request that omits `scope` is treated as asking for the scope
   *              originally granted, so inheriting the original REQUEST would
   *              quietly re-widen a connection the user had narrowed at the
   *              consent screen.
   *
   * Access-token scopes only in both cases — `oauth.authorizationScopes` are
   * requested but never granted, and must not reach this list.
   */
  requestedAccessScopes: readonly string[];

  /** Injected so the derived expiry is deterministic under test. */
  nowMs: number;
};

export type NormalizedOAuthCredential = {
  /** The serialized envelope, ready for Vault. Never logged, never returned to a caller. */
  secret: string;

  /** What `integration_connections.scopes` stores. */
  accessScopes: string[];

  /** ISO 8601, or null when the server did not say. See the note below. */
  expiresAt: string | null;
};

/**
 * Turns a token endpoint response into the two columns and one secret that a
 * connection is made of.
 *
 * PURE ON PURPOSE. No database, no provider branch, no clock. The callback and
 * the refresh service both end at exactly this point — "I hold a
 * TokenEndpointResponse, what do I store?" — and writing that answer twice is
 * how the two paths drift. Persisting is the caller's job; the name says
 * `normalize` rather than `persist` so it does not promise a side effect it
 * does not have.
 */
export function normalizeTokenResponse(
  input: NormalizeTokenResponseInput,
): NormalizedOAuthCredential {
  const accessToken =
    typeof input.tokens.access_token === 'string' ? input.tokens.access_token.trim() : '';
  if (!accessToken) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_token_response_invalid',
      'OAuth token response did not contain an access token.',
    );
  }

  // `||` and not `??`: a server that returns an empty-string refresh token has
  // told us nothing, and dropping the working one we already hold would end the
  // connection at the next expiry.
  const rotated =
    typeof input.tokens.refresh_token === 'string' ? input.tokens.refresh_token.trim() : '';
  const refreshToken = rotated || input.previous?.refreshToken;

  // RFC 6749 §5.1: `scope` is "OPTIONAL, if identical to the scope requested by
  // the client; otherwise, REQUIRED" — and §3.3 obliges a server whose grant
  // differs to send it. So silence is not ambiguity: it means "exactly what you
  // asked for", and the fallback is a reading of the spec rather than a guess.
  const accessScopes = input.tokens.scope
    ? parseScope(input.tokens.scope)
    : [...input.requestedAccessScopes];

  return {
    secret: serializeOAuthCredentialSecret({
      accessToken,
      refreshToken,
      tokenType: input.tokens.token_type,
    }),
    accessScopes,
    expiresAt: deriveExpiresAt(input.tokens, input.nowMs),
  };
}

/**
 * `null` means THE SERVER DID NOT SAY, and nothing else.
 *
 * `expires_in` is RECOMMENDED, not REQUIRED (RFC 6749 §5.1: "If omitted, the
 * authorization server SHOULD provide the expiration time via other means or
 * document the default value"), so absence is conformant and must be a legal
 * stored state rather than an error.
 *
 * It is also not a licence to invent a default. `openid-client` computes an
 * expiry only `if (response.expires_in !== undefined)` with no else, and n8n's
 * OAuth2 callback guards the same way — both refuse to answer a question the
 * server declined to answer, and we hold strictly less information than either.
 * A guess that runs long serves a dead token and earns a 401; a guess that runs
 * short churns refresh tokens that rotate.
 *
 * ZERO IS NOT NULL. `expiresIn()` returns 0 for a token that is already expired
 * — that is knowledge, not silence — so it becomes a timestamp of `now` and the
 * accessor refuses it with `integration_credential_expired`. Collapsing it to
 * null would make a known-dead token look like one of unknown lifetime and send
 * it out to earn a 401 instead.
 */
function deriveExpiresAt(tokens: GrantTokenResponse, nowMs: number): string | null {
  // Prefer the helper — it subtracts the time already spent in transit — and
  // fall back to the raw field, which is all a hand-built fixture carries.
  const seconds =
    typeof tokens.expiresIn === 'function' ? tokens.expiresIn() : tokens.expires_in;

  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return new Date(nowMs + seconds * 1000).toISOString();
}

/**
 * RFC 6749 §3.3: scope is "expressed as a list of space-delimited,
 * case-sensitive strings". Split on any whitespace run and drop the empties, so
 * a server that pads or tabs its list does not produce a scope named "".
 * De-duplicated with the first occurrence winning, because the list is compared
 * by membership and a repeat carries no meaning.
 */
export function parseScope(scope: string): string[] {
  return [...new Set(scope.split(/\s+/).filter(Boolean))];
}
