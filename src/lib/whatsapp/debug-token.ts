import 'server-only';

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

/**
 * `GET /{version}/debug_token` — what Meta says about the access token we hold.
 *
 * This closes gap G7: nothing in this codebase ever asked Meta whether the
 * WhatsApp token was still valid. The failure mode it exists for is silent —
 * a System User token whose data-access window lapses keeps its shape, so every
 * send starts failing with a provider error nobody expected, and the admin
 * panel goes on reporting the channel as "מוגדר".
 *
 * VERIFIED against the live reference (developers.facebook.com/docs/graph-api/
 * reference/debug_token/, read 2026-09-13): it is a GET; `input_token` is the
 * token being inspected; `access_token` must be an APP access token (or a
 * token belonging to a developer of that app), which is why this needs the app
 * id and app secret and not just the token itself. The `data` fields used here
 * — is_valid, expires_at, data_access_expires_at, scopes — are all in the
 * documented response shape.
 *
 * WHAT THE DOCS DO NOT SAY, recorded so nobody re-derives it as fact: the
 * reference gives no meaning for `expires_at = 0`. The convention is "never
 * expires", and every long-lived System User token returns it, but that is
 * INFERRED. The value is surfaced as-is and the caller decides the wording;
 * `dataAccessExpiresAt` is the one that carries a real deadline either way.
 *
 * SECRETS: the app secret and both tokens are arguments, never module state,
 * and none of them appears in a thrown message. A failure returns a code and a
 * generic reason — the caller renders that, so an admin screen can report
 * "המפתח נדחה" without the value ever reaching a log or a browser.
 */

export type DebugTokenResult = {
  isValid: boolean;
  /** Unix seconds. 0 is what Meta returns for a token with no expiry. */
  expiresAt: number | null;
  /** Unix seconds. The System User data-access window — the real deadline. */
  dataAccessExpiresAt: number | null;
  scopes: string[];
  /** Meta's own explanation when is_valid is false (never the token). */
  invalidReason: string | null;
};

type DebugTokenResponse = {
  data?: {
    is_valid?: boolean;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: string[];
    error?: { message?: string; code?: number };
  };
  error?: { message?: string; code?: number };
};

// Unix-seconds field that Meta may omit entirely. 0 is kept as 0 — it is
// meaningful (see the header) and must not collapse into "unknown".
function unixOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function debugToken(input: {
  appId: string;
  appSecret: string;
  token: string;
}): Promise<DebugTokenResult> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token`,
  );
  url.searchParams.set('input_token', input.token);
  // The app access token is literally "{app-id}|{app-secret}". It goes in the
  // query string because that is the documented parameter; it is never logged,
  // and the URL object is not surfaced on any error path below.
  url.searchParams.set('access_token', `${input.appId}|${input.appSecret}`);

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    // Never cached: the whole point is the CURRENT state of the token.
    cache: 'no-store',
  });

  const body = (await res.json().catch(() => ({}))) as DebugTokenResponse;

  // A top-level error means the APP credentials were rejected, not the token
  // under inspection — a different problem with a different fix, so it is not
  // flattened into "the token is invalid".
  if (body.error) {
    throw new Error(
      `debug_token rejected the app credentials (code ${body.error.code ?? 'unknown'})`,
    );
  }
  if (!res.ok || !body.data) {
    throw new Error(`debug_token failed with HTTP ${res.status}`);
  }

  const data = body.data;
  return {
    isValid: data.is_valid === true,
    expiresAt: unixOrNull(data.expires_at),
    dataAccessExpiresAt: unixOrNull(data.data_access_expires_at),
    scopes: Array.isArray(data.scopes)
      ? data.scopes.filter((s): s is string => typeof s === 'string')
      : [],
    // Meta puts the reason inside data.error when the token itself is bad.
    invalidReason:
      typeof data.error?.message === 'string' ? data.error.message : null,
  };
}
