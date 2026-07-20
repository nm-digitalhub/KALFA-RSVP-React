import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getPublicSupabaseEnv } from '@/lib/supabase/env';
import type { Database } from '@/lib/supabase/types';

// Bearer-token authentication for the native agent-console app's JSON API.
//
// The cookie DAL (`@/lib/auth/dal`) is for browser pages: it reads cookies and
// `redirect()`s on failure. A native app instead sends `Authorization: Bearer
// <supabase-jwt>` and expects a JSON 401/403. This module is that ISOLATED path —
// it does not touch the cookie DAL and never redirects.

export interface ConsoleAgentContext {
  userId: string;
  // A Supabase client scoped to the caller's JWT (RLS runs as the user). Use it
  // for RLS-scoped reads / own-row writes; reach for createAdminClient() only where
  // a service-role bypass is genuinely required (and re-verify ownership yourself).
  supabase: SupabaseClient<Database>;
}

export type ConsoleAgentResult =
  | { ok: true; ctx: ConsoleAgentContext }
  | { ok: false; status: 401 | 403; error: string };

// Generic, privacy-safe messages — never leak auth/DB detail to the client.
const UNAUTH = { ok: false as const, status: 401 as const, error: 'לא מורשה' };
const FORBIDDEN = { ok: false as const, status: 403 as const, error: 'אין הרשאה' };

function extractBearer(request: Request): string | null {
  const authz = request.headers.get('authorization');
  if (!authz) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
  return m ? m[1].trim() : null;
}

// A request-scoped client authenticated AS the caller's JWT (not the cookie client,
// not the service-role client). Both getUser() and any subsequent RLS-scoped
// query/RPC run under that user's auth.uid().
function bearerClient(jwt: string): SupabaseClient<Database> {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Authenticate a native-app request by Supabase JWT and gate it on console-agent
 * membership. Returns typed JSON-friendly failures (401/403), never a redirect.
 *
 * `is_console_agent()` is the fixed, staff-gated function (a console agent must be
 * platform staff — migration 20260720234500 + FK 20260721005100), so this single
 * check covers the operational axis. Per-action AUTHORITY (may you issue AI
 * commands, see PII, …) is a SEPARATE route-level check — see
 * callerHasPlatformPermission(). Fails CLOSED: any error → 401/403, never open.
 */
export async function requireConsoleAgent(request: Request): Promise<ConsoleAgentResult> {
  const jwt = extractBearer(request);
  if (!jwt) return UNAUTH;

  const supabase = bearerClient(jwt);

  // getUser(jwt) validates the token against the Auth server (never getSession).
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return UNAUTH;

  // Console-agent gate (server-side, staff-enforced). A false/error result is
  // forbidden — never fail open.
  const { data: isAgent, error: rpcErr } = await supabase.rpc('is_console_agent');
  if (rpcErr || isAgent !== true) return FORBIDDEN;

  return { ok: true, ctx: { userId: userData.user.id, supabase } };
}

/**
 * Whether the caller holds a platform permission (e.g. 'manage_voice' for issuing
 * AI commands). Uses the caller-scoped client so has_platform_permission() resolves
 * auth.uid() server-side. Non-throwing: an error resolves to false (fail closed).
 */
export async function callerHasPlatformPermission(
  supabase: SupabaseClient<Database>,
  key: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_platform_permission', { _key: key });
  if (error) return false;
  return data === true;
}
