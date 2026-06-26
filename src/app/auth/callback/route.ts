import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

// Handles the Supabase auth code exchange (email confirmation / OAuth).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/app';
  // Only allow internal absolute paths — block open-redirects via ?next=.
  const next =
    nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/app';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Relative redirect so it resolves against the public origin behind the
      // reverse proxy (request.url is the internal host here).
      return new NextResponse(null, { status: 303, headers: { Location: next } });
    }
  }

  return new NextResponse(null, {
    status: 303,
    headers: { Location: '/auth/login?error=auth' },
  });
}
