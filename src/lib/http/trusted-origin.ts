// A narrow, deliberate duplication of `originFromEnv()` from `@/lib/url` —
// NOT a re-export, NOT an import of `getAppOrigin()`. Two independent
// reasons, both real:
//
// 1. Trust: the internal self-fetch in serve-markdown.ts must target a fixed,
//    known-good origin — never `request.nextUrl.origin` / `request.url`,
//    which Next.js derives from the incoming Host header and which an
//    attacker controls. `@/lib/url`'s own header comment states this exact
//    policy for the same reason (auth links, redirects): "We deliberately do
//    NOT derive the origin from the incoming Host / X-Forwarded-Host header:
//    those are attacker-controllable." This module applies the identical
//    policy to the proxy layer.
//
// 2. Proxy-graph safety: `@/lib/url` imports `'server-only'`. Verified
//    2026-08-24 by tracing the full static import graph already reachable
//    from `src/proxy.ts` (the only code Next actually loads into the Proxy
//    compilation unit): zero files in that graph import `'server-only'`, and
//    `src/lib/security/server-action-id.ts` — the one existing helper
//    proxy.ts already imports — deliberately avoids it too. Next.js's own
//    docs describe `server-only` only in terms of the Server/Client
//    Component boundary; nothing documents its behavior inside the separate
//    Proxy/Middleware compilation unit. Rather than being the first import to
//    test that undocumented combination, this module follows the graph's
//    existing, proven convention.
//
// Keep in sync with `originFromEnv()` in `@/lib/url` if that validation ever
// changes — same APP_ORIGIN contract, same failure semantics.

function originFromEnv(): string | null {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) return null;
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
 * The trusted app origin for the proxy layer's own internal self-fetch.
 * Resolves from APP_ORIGIN only — never from the request's Host header. In
 * production a missing/invalid APP_ORIGIN throws (fail closed: the markdown
 * branch must not silently fetch an attacker-influenced URL). In development
 * it falls back to a fixed localhost origin, mirroring `getAppOrigin()`.
 */
export function trustedAppOrigin(): string {
  const fromEnv = originFromEnv();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_ORIGIN is required in production but is not set — refusing to derive the markdown self-fetch origin from the request Host header.',
    );
  }
  return 'http://127.0.0.1:3000';
}
