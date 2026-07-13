import { createBrowserClient } from '@supabase/ssr';

import { getPublicSupabaseEnv } from './env';
import type { Database } from './types';

// Browser Supabase client for Client Components. Uses the public anon key only.
// `experimental.passkey` opts into WebAuthn passkey auth (registerPasskey /
// signInWithPasskey); it is required per the Supabase docs and is inert for
// non-passkey calls. @supabase/ssr's createBrowserClient persists the session to
// cookies, so a passkey sign-in in the browser is picked up by the server on the
// next request.
export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey, {
    auth: { experimental: { passkey: true } },
  });
}
