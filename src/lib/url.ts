import 'server-only';

import { headers } from 'next/headers';

// Absolute, shareable app URLs (RSVP links, org-invite links, email links).
//
// The App Router exposes no built-in "request origin" for a Server Component or
// Server Action — the documented way to learn the incoming host is the
// `headers()` API (https://nextjs.org/docs/app/api-reference/functions/headers).
// We therefore resolve the origin in two steps:
//
//   1. Prefer the explicitly-configured APP_ORIGIN. It is stable, not
//      attacker-controllable (unlike the Host header), and works even outside a
//      request context. This is the same server-only var the billing routes
//      require (orders/pay, campaigns/*).
//   2. Fall back to the request headers that nginx forwards
//      (X-Forwarded-Host / Host + X-Forwarded-Proto — see conf.d/beta-proxy.conf)
//      so a link is still absolute and shareable if APP_ORIGIN is ever unset.
//
// When APP_ORIGIN is set, `headers()` is never read, so callers keep whatever
// rendering mode they already had.

function originFromEnv(): string | null {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) return null;
  return configured.replace(/\/+$/, '');
}

/**
 * The absolute origin (scheme + host, no trailing slash) for building links.
 * Throws only if APP_ORIGIN is unset AND there is no request host to derive
 * from — i.e. genuine misconfiguration, never during a normal page/action render.
 */
export async function getAppOrigin(): Promise<string> {
  const fromEnv = originFromEnv();
  if (fromEnv) return fromEnv;

  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (host) {
    const proto = requestHeaders.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}`;
  }

  throw new Error(
    'Cannot resolve app origin: APP_ORIGIN is not configured and the request has no host header',
  );
}

/** Build an absolute URL for an app-relative `path` (leading slash optional). */
export async function getAppUrl(path: string): Promise<string> {
  const origin = await getAppOrigin();
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
