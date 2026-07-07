import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getPublicSupabaseEnv } from '@/lib/supabase/env';

// Session refresh + optimistic auth redirect for the Next.js proxy (middleware),
// following the official @supabase/ssr pattern (updateSession). The root
// src/proxy.ts is a thin wrapper around this. Real authorization still happens
// close to the data (src/lib/auth/dal.ts uses getUser(), which verifies with the
// Auth server and is revocation-aware); this proxy is OPTIMISTIC only.

const PROTECTED_PREFIXES = ['/app', '/admin'];
const AUTH_PAGES = ['/auth/login', '/auth/signup'];

// Per the official warning: when returning a NEW response (e.g. a redirect), copy
// over BOTH the cookies AND the exact headers @supabase/ssr handed to setAll. The
// library sets no-store cache headers alongside auth cookies so that a response
// carrying session cookies is never cached by a reverse proxy / CDN and served to
// another user. We copy the WHOLE delivered `headers` object (captured verbatim
// from setAll) rather than a hardcoded name list, so if the library adds a new
// mandatory header the redirect keeps working with no further manual change.
function withRefreshedSession(
  target: NextResponse,
  from: NextResponse,
  refreshHeaders: Record<string, string>,
): NextResponse {
  from.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  Object.entries(refreshHeaders).forEach(([key, value]) => target.headers.set(key, value));
  return target;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  // The exact headers @supabase/ssr asks us to set alongside auth cookies,
  // captured verbatim from setAll so a redirect can carry ALL of them (see above).
  const refreshHeaders: Record<string, string> = {};

  const { url, anonKey } = getPublicSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.assign(refreshHeaders, headers);
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value),
        );
      },
    },
  });

  // IMPORTANT: do NOT run code between createServerClient and getClaims(), and do
  // NOT remove getClaims() — a mistake here can make users appear randomly logged
  // out. Per the installed auth-js (2.108.2), getClaims() decodes the session JWT
  // and verifies it one of two ways: an ASYMMETRIC token (alg not "HS*", with a
  // kid + WebCrypto) is verified LOCALLY against the fetched JWK (no per-request
  // round-trip); a SYMMETRIC "HS*" token (or missing kid) falls back to
  // getUser(token), a call to the Auth server. This project publishes an ES256
  // key, so the local path is available for ES256 sessions. Either way, treat this
  // proxy check as OPTIMISTIC and never the security boundary — the authoritative,
  // revocation-aware check is getUser() at the data layer (src/lib/auth/dal.ts).
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (!user && isProtected) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirectTo', path);
    return withRefreshedSession(
      NextResponse.redirect(loginUrl),
      supabaseResponse,
      refreshHeaders,
    );
  }

  if (user && AUTH_PAGES.includes(path)) {
    return withRefreshedSession(
      NextResponse.redirect(new URL('/app', request.url)),
      supabaseResponse,
      refreshHeaders,
    );
  }

  // MUST return supabaseResponse as-is — its cookies carry any refreshed token.
  return supabaseResponse;
}
