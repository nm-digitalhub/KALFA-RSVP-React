import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/url';

// Server-side landing for Supabase auth EMAIL links (invite / recovery /
// magiclink): verifies the token_hash via the standard @supabase/ssr flow —
// verifyOtp on the cookie client establishes the session server-side — then
// redirects to `next`. Without this route, GoTrue email links can never
// produce a cookie session in this app (they land on /auth/login instead).
// `next` is pinned to same-origin relative paths — never an open redirect.
const ALLOWED_TYPES = new Set(['invite', 'recovery', 'magiclink', 'email', 'signup']);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get('token_hash') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const rawNext = url.searchParams.get('next') ?? '/app';
  // Relative same-origin only; an ABSOLUTE next (the email template passes
  // {{ .RedirectTo }} verbatim) is accepted iff it is OUR origin — reduced to
  // its path. Anything else falls back to /app (never an open redirect).
  let next = '/app';
  if (rawNext.startsWith('/') && !rawNext.startsWith('//')) {
    next = rawNext;
  } else {
    try {
      const abs = new URL(rawNext);
      const own = new URL(await getAppUrl('/'));
      if (abs.origin === own.origin) next = abs.pathname + abs.search;
    } catch {
      /* keep /app */
    }
  }

  if (!tokenHash || !ALLOWED_TYPES.has(type)) {
    return NextResponse.redirect(await getAppUrl('/auth/login'), 303);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'invite' | 'recovery' | 'magiclink' | 'email' | 'signup',
  });
  if (error) {
    // Expired/used link — generic, privacy-safe landing.
    return NextResponse.redirect(await getAppUrl('/auth/login'), 303);
  }
  return NextResponse.redirect(await getAppUrl(next), 303);
}
