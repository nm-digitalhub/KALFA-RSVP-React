import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Relative redirect: behind the reverse proxy request.url resolves to the
  // internal host (127.0.0.1:3002), so an absolute redirect would send the
  // browser to the wrong origin. The browser resolves a relative Location
  // against the public URL it requested.
  return new NextResponse(null, { status: 303, headers: { Location: '/' } });
}
