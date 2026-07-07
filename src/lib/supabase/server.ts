import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { getPublicSupabaseEnv } from './env';
import type { Database } from './types';

// Request-scoped Supabase client for Server Components, Server Actions, and
// Route Handlers. Uses the cookie-based session via @supabase/ssr.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, _headers) {
        // `_headers` (Cache-Control: no-store …) is applied only in the proxy,
        // where the outgoing response is writable — a Server Component can't set
        // response headers, and cookie writes there throw (handled below).
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `set` throws when called from a Server Component (cookies are
          // read-only during render). The session is refreshed in proxy.ts,
          // so this can be safely ignored here.
        }
      },
    },
  });
}
