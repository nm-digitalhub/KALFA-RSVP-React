import 'server-only';

// Absolute, shareable app URLs (RSVP links, org-invite links, email links, and
// auth links such as password-reset / magic-link).
//
// The origin comes from ONE trusted source: the explicitly-configured APP_ORIGIN
// server var. It is stable, not attacker-controllable, works outside a request
// context, and is the same server-only var the billing routes require
// (campaign payment routes).
//
// We deliberately do NOT derive the origin from the incoming Host /
// X-Forwarded-Host header: those are attacker-controllable, and building an auth
// link (password reset, magic link) or any absolute URL from them enables
// host-header injection. In production a missing APP_ORIGIN is therefore a hard
// error — never a silent Host fallback.

function originFromEnv(): string | null {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) return null;
  // Parse and validate: APP_ORIGIN must be a bare http(s) origin — no credentials,
  // path, query or fragment — so we only ever hand back a trusted `url.origin`.
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('APP_ORIGIN is not a valid absolute URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use http:// or https://.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('APP_ORIGIN must not include credentials.');
  }
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    throw new Error('APP_ORIGIN must not include a path, query, or fragment.');
  }
  return url.origin;
}

/**
 * The absolute origin (scheme + host, no trailing slash) for building links.
 * Resolves from APP_ORIGIN only. In production a missing APP_ORIGIN throws (we
 * never fall back to the request Host). In local development it falls back to a
 * fixed localhost origin so links resolve without extra setup.
 */
export async function getAppOrigin(): Promise<string> {
  const fromEnv = originFromEnv();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_ORIGIN is required in production but is not set — refusing to derive the auth/link origin from the request Host header.',
    );
  }

  // Local development only: a fixed, explicit localhost origin (mirrors
  // supabase/config.toml `site_url`). Never reads the request Host header.
  return 'http://127.0.0.1:3000';
}

// Building blocks for the shared redirect/link policy (see resolveInternalTarget).
// SCHEME_LIKE detects a leading scheme (`https:`…) so scheme-bearing values are
// parsed standalone; CONTROL_OR_BACKSLASH + LEADING_WHITESPACE reject inputs the
// URL parser would normalize (`\`→`/`, stripped tab/newline/CR) into a `//host`
// authority override.
const SCHEME_LIKE = /^[A-Za-z][A-Za-z\d+.-]*:/;
const CONTROL_OR_BACKSLASH = new RegExp(String.raw`[\u0000-\u001F\u007F\\]`);
const LEADING_WHITESPACE = /^\s/u;

/**
 * Shared policy: validate a user/template-supplied redirect or link `value` and
 * resolve it to a URL on our EXACT APP_ORIGIN, or THROW. Used by BOTH getAppUrl
 * and the /auth/confirm route so the two can never drift.
 *
 * Rejected: backslashes / control chars / leading whitespace (URL parsers
 * normalize these into `//host` authority overrides); non-http(s) schemes;
 * credentials; and anything that does not resolve to our origin — including
 * scheme-bearing inputs like `https:evil`, `http:evil`, `https:/evil`, which are
 * parsed WITHOUT a base so they cannot be coerced into the internal path `/evil`.
 */
async function resolveInternalTarget(value: string): Promise<URL> {
  // `//host` (and `///host`, `////host`) is a protocol-relative URL that resolves
  // to an EXTERNAL host — reject it up front even when it points at our own host,
  // so a protocol-relative form can never be treated as a same-origin path.
  if (
    value.startsWith('//') ||
    CONTROL_OR_BACKSLASH.test(value) ||
    LEADING_WHITESPACE.test(value)
  ) {
    throw new Error('Refusing an ambiguous redirect/link target.');
  }
  const base = new URL(await getAppOrigin());
  // A scheme-bearing value is parsed STANDALONE (no base): `https:evil` becomes
  // the host `evil` (rejected below), never `/evil` on our origin.
  const target = SCHEME_LIKE.test(value) ? new URL(value) : new URL(value, base);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Refusing a non-http(s) redirect/link target.');
  }
  if (
    target.origin !== base.origin ||
    target.username !== '' ||
    target.password !== ''
  ) {
    throw new Error('Refusing a redirect/link target outside APP_ORIGIN.');
  }
  return target;
}

/**
 * Build an absolute URL for an app-relative (or same-origin absolute) `path`.
 * Serializes the WHOLE resolved URL, so query AND hash are preserved. Anything
 * ambiguous or off-origin THROWS — never silently coerced into an internal path.
 */
export async function getAppUrl(path: string): Promise<string> {
  return (await resolveInternalTarget(path)).toString();
}

/**
 * Validate + reduce a user/template-supplied redirect target (e.g. the recovery
 * email's `next`) to a safe same-origin `pathname + search`, using the SAME
 * policy as getAppUrl. Callers provide their own fallback on throw (e.g. /app).
 * Redirect targets intentionally return pathname + search only. Fragments are
 * excluded from this server-side redirect contract.
 */
export async function resolveAppRedirectPath(value: string): Promise<string> {
  const target = await resolveInternalTarget(value);
  return target.pathname + target.search;
}
