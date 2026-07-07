import { type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 renamed `middleware` to `proxy` (Node.js runtime by default). This
// is a thin wrapper — the Supabase session refresh + optimistic auth redirect
// live in the official-pattern helper (src/lib/supabase/proxy.ts::updateSession).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on everything except static assets and image files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
