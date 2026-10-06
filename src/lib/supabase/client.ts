import { createBrowserClient } from '@supabase/ssr';

import { getPublicSupabaseEnv } from './env';
import type { Database } from './types';

// Browser Supabase client for Client Components. Uses the public anon key only.
// `experimental.passkey` was formerly required to enable WebAuthn passkey auth
// (registerPasskey / signInWithPasskey); the installed auth-js enables passkeys
// by default and ignores the flag (deprecated, kept so the option still
// compiles). @supabase/ssr's createBrowserClient persists the session to
// cookies, so a passkey sign-in in the browser is picked up by the server on the
// next request.
export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey, {
    auth: { experimental: { passkey: true } },
  });
}
