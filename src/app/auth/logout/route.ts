import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  // `local` scope: the library removes this device's session (the auth cookies)
  // BEFORE it calls the server, so signing out here never depends on the network.
  // With the default `global` scope, supabase-js 2.119 keeps the session when the
  // server call fails, and the button would leave the user signed in. Sessions on
  // the user's other devices stay signed in (docs: guides/auth/signout).
  await supabase.auth.signOut({ scope: 'local' });
  // Relative redirect: behind the reverse proxy request.url resolves to the
  // internal host (127.0.0.1:3002), so an absolute redirect would send the
  // browser to the wrong origin. The browser resolves a relative Location
  // against the public URL it requested.
  return new NextResponse(null, { status: 303, headers: { Location: '/' } });
}
