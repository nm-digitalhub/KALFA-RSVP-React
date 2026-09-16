import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { createAdminClient } from '@/lib/supabase/admin';

// Read and write `integration_provider_configs` — this deployment's OAuth client
// for a provider, which is what makes "connect an account" possible at all.
//
// ⚠️ THE SERVICE-ROLE CLIENT, NOT THE COOKIE CLIENT, AND THAT IS A DIVERGENCE
// FROM ITS NEIGHBOURS. `send-policy.ts` next door uses the cookie client so that
// admin-only RLS on `app_settings` applies on top of the app gate. That is not
// available here: `integration_provider_configs` is a CLOSED table — RLS enabled
// with zero policies, and every grant to `anon` and `authenticated` revoked — so
// a cookie client reads nothing at all. The app gate below is therefore the
// whole control, which is exactly why it is the first statement in both
// functions rather than something a caller is trusted to have done.
//
// ⚠️ THE CLIENT SECRET NEVER LEAVES THIS MODULE, IN EITHER DIRECTION. The read
// selects `vault_secret_id` only to answer "is one stored", and converts it to a
// boolean before returning — a uuid is worthless without the vault privilege,
// but it is also of no use to a form, and a value that never reaches React
// cannot be serialised into an RSC payload by accident.

export type AdminOAuthProviderConfig = {
  /** A row exists AND it has a stored client secret — the state that lets a flow start. */
  configured: boolean;
  /** Not a credential: it travels in the authorization URL in plain sight. */
  clientId: string | null;
  enabled: boolean;
  /** Present only once a row exists. */
  createdBy: string | null;
  updatedAt: string | null;
};

export const UNCONFIGURED_OAUTH_PROVIDER: AdminOAuthProviderConfig = {
  configured: false,
  clientId: null,
  enabled: false,
  createdBy: null,
  updatedAt: null,
};

export async function readOAuthProviderConfig(
  provider: string,
): Promise<AdminOAuthProviderConfig> {
  await requirePlatformPermission('integrations.read');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('integration_provider_configs')
    .select('client_id, enabled, created_by, updated_at, vault_secret_id')
    .eq('provider', provider)
    .maybeSingle();

  // A read failure is reported as "not configured" rather than thrown: this
  // feeds a status card, and a panel that renders an error boundary because one
  // card could not load is worse than one that says the provider is not set up.
  // A save still fails loudly, which is where it matters.
  if (error || !data) return UNCONFIGURED_OAUTH_PROVIDER;

  return {
    // `vault_secret_id` collapses to a boolean HERE and is never returned.
    configured: data.vault_secret_id !== null,
    clientId: data.client_id,
    enabled: data.enabled,
    createdBy: data.created_by,
    updatedAt: data.updated_at,
  };
}

export async function saveOAuthProviderConfig(input: {
  provider: string;
  clientId: string;
  /**
   * '' means KEEP THE STORED SECRET. That is the RPC's contract, not a
   * convenience here: on an existing row a blank secret leaves Vault untouched,
   * and on a first write the function refuses. It is what lets an operator
   * toggle `enabled` or correct a client id without re-typing a secret they may
   * not have kept.
   */
  clientSecret: string;
  enabled: boolean;
}): Promise<void> {
  const user = await requirePlatformPermission('integrations.manage');

  const admin = createAdminClient();
  const { error } = await admin.rpc('integrations_upsert_provider_config', {
    p_provider: input.provider,
    p_client_id: input.clientId,
    p_secret: input.clientSecret,
    p_enabled: input.enabled,
    p_extra: {},
    // From the SESSION, never from the form. `auth.uid()` is NULL under the
    // service role — measured — so this parameter is the only provenance there
    // is, and a form field would make it something a browser could assert.
    p_created_by: user.id,
  });

  if (error) throw error;

  // No secret, no client id, no uuid. Enough to answer "who changed the
  // integration configuration and when", which is the audit question.
  await logActivity({
    action: 'admin.integration_provider_config.saved',
    meta: { provider: input.provider, enabled: input.enabled, secretSubmitted: input.clientSecret !== '' },
  });
}
