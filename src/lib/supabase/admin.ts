import 'server-only';

import { createClient as createServiceClient } from '@supabase/supabase-js';

import type { Database } from './types';

// The literal value currently seeded in .env / .env.example. Treated as
// "not configured" so a placeholder deployment fails loudly instead of
// silently attempting calls with an invalid key.
const PLACEHOLDER_SERVICE_ROLE_KEY = 'placeholder-service-role-key';

// Shared by createAdminClient() and getInfraConfigStatus() so the "is this a
// real key" definition lives in exactly one place.
export function isConfiguredServiceRoleKey(
  key: string | undefined,
): key is string {
  return !!key && key !== PLACEHOLDER_SERVICE_ROLE_KEY;
}

/**
 * Supabase client authenticated with the SERVICE ROLE key.
 *
 * WARNING: this client BYPASSES Row Level Security. It must only be used in
 * trusted server-side code (Server Actions, Route Handlers, server modules)
 * and must NEVER be constructed in, imported by, or sent to the browser.
 * The `server-only` import above enforces that at build time.
 *
 * Unlike the request-scoped client in `server.ts`, this one is stateless: it
 * carries no user session and does not read or write auth cookies, so we
 * disable token refresh and session persistence.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }

  // Reject a missing key and the known placeholder value. Never log the key.
  if (!isConfiguredServiceRoleKey(serviceRoleKey)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  return createServiceClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
