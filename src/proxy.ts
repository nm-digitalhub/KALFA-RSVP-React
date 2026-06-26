import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { getPublicSupabaseEnv } from '@/lib/supabase/env';

// Next.js 16 renamed `middleware` to `proxy` (Node.js runtime by default).
// Responsibilities here are intentionally limited to:
//   1. Refreshing the Supabase session (so server reads see a fresh token).
//   2. An optimistic redirect for unauthenticated access to protected areas.
// Real authorization still happens close to the data (see src/lib/auth/dal.ts
// and the ownership-scoped data layer) — proxy is never the only line of defense.

const PROTECTED_PREFIXES = ['/app', '/admin'];
const AUTH_PAGES = ['/auth/login', '/auth/signup'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, anonKey } = getPublicSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // IMPORTANT: getUser() (not getSession()) — it verifies the token with the
  // Auth server and triggers the refresh that writes cookies via setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (!user && isProtected) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirectTo', path);
    return NextResponse.redirect(loginUrl);
  }

  if (user && AUTH_PAGES.includes(path)) {
    return NextResponse.redirect(new URL('/app', request.url));
  }

  return response;
}

export const config = {
  // Run on everything except static assets and image files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
