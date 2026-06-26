import { createBrowserClient } from '@supabase/ssr';

import { getPublicSupabaseEnv } from './env';
import type { Database } from './types';

// Browser Supabase client for Client Components. Uses the public anon key only.
export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
