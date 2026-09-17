/**
 * What an OAuth failure may say about itself in a log line.
 *
 * ⚠️ THIS FILE EXISTS TO SAY AS LITTLE AS POSSIBLE, NOT AS MUCH.
 *
 * `IntegrationRuntimeError` already carries our own `code`, which names WHICH
 * STEP failed. It cannot say WHY, because the reason lives in a `cause` chain
 * thrown by the OAuth library, and that chain is not safe to log: a
 * `ResponseBodyError` holds the token endpoint's response, and an
 * `AuthorizationResponseError` holds values copied straight out of a URL an
 * unauthenticated caller controls. Logging either whole would put provider
 * responses — and attacker-supplied text — into our logs.
 *
 * So this reader extracts exactly two things, both of which are FIXED
 * VOCABULARIES rather than content:
 *
 *   oauthError    the RFC 6749 §5.2 error code — `invalid_grant`,
 *                 `invalid_client`, `unauthorized_client` … This is the
 *                 difference between "the code/redirect_uri was rejected" and
 *                 "our client credentials were rejected", which is the single
 *                 most useful bit when a connection will not complete.
 *
 *   providerCode  Microsoft's `AADSTS` identifier, if the description contains
 *                 one. It is a stable, public, documented error number
 *                 (AADSTS50011 = redirect URI mismatch, AADSTS7000215 = invalid
 *                 client secret). It names the cause exactly and carries no
 *                 account, token or tenant data.
 *
 * Everything else is dropped: the message, the description, the correlation id,
 * the timestamp, the response body, the headers.
 */

/** RFC 6749 §5.2 error codes are lowercase ASCII with underscores, and short. */
const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/;

/**
 * Microsoft's public error identifier. Anchored on the literal prefix and a
 * bounded run of digits, so nothing else in a description can be captured.
 */
const PROVIDER_ERROR_CODE = /\bAADSTS\d{4,7}\b/;

/** How far up a `cause` chain to look before giving up. */
const MAX_CAUSE_DEPTH = 5;

export type OAuthFailureDetail = {
  /** RFC 6749 error code, or null when the failure carried none. */
  oauthError: string | null;
  /** Provider-specific public error id (e.g. `AADSTS50011`), or null. */
  providerCode: string | null;
  /** HTTP status of the provider response, when the failure carried one. */
  status: number | null;
};

export const NO_OAUTH_FAILURE_DETAIL: OAuthFailureDetail = {
  oauthError: null,
  providerCode: null,
  status: null,
};

/**
 * Walk the `cause` chain and report only the two safe identifiers.
 *
 * ⚠️ STRUCTURAL, NOT `instanceof`. The OAuth library may be bundled more than
 * once, and an `instanceof` check against our copy of the class would silently
 * miss an error thrown by another copy — reporting "nothing to say" about a
 * failure that said plenty. The same reason `readIntegrationRuntimeError` is
 * structural.
 */
export function readOAuthFailureDetail(error: unknown): OAuthFailureDetail {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) break;

    const record = current as {
      error?: unknown;
      error_description?: unknown;
      status?: unknown;
      cause?: unknown;
    };

    const oauthError =
      typeof record.error === 'string' && OAUTH_ERROR_CODE.test(record.error)
        ? record.error
        : null;

    const providerCode =
      typeof record.error_description === 'string'
        ? (record.error_description.match(PROVIDER_ERROR_CODE)?.[0] ?? null)
        : null;

    // Report from the first level that said anything at all. A level carrying
    // only a status is not "something" — the status alone would send us looking
    // at the wrong layer.
    if (oauthError !== null || providerCode !== null) {
      return {
        oauthError,
        providerCode,
        status: typeof record.status === 'number' ? record.status : null,
      };
    }

    current = record.cause;
  }

  return NO_OAUTH_FAILURE_DETAIL;
}
