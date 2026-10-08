import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { isCardcomTestTerminal } from '@/lib/data/cardcom-config';
import { createAdminClient } from '@/lib/supabase/admin';

// The admin side of the CardCom connection (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, D1): what the
// settings page shows, and what its form saves.
//
// ⚠️ THE SERVICE-ROLE CLIENT, for the same reason as oauth-provider-config.ts next door: `cardcom_config` is a CLOSED
// table (RLS with no policy, every client grant revoked), so a cookie client reads nothing. The permission check is
// therefore the whole control, and it is the first statement in both functions.
//
// ⚠️ THE API PASSWORD NEVER LEAVES THIS MODULE AS A VALUE. The read selects the vault secret id only to answer "is one
// stored" and converts it to a boolean; the write hands the password to the vault function and records in the audit
// log only that one was submitted. The form never receives it back, so there is nothing to serialise by accident.

export type AdminCardcomConfig = {
  /** A row was ever saved. */
  exists: boolean;
  terminalNumber: number | null;
  apiName: string | null;
  /** The pilot switch. */
  enabled: boolean;
  /** A password is stored in the vault (needed to refund, and to switch the pilot on). */
  hasPassword: boolean;
  /** CardCom's published test terminal: nothing is charged on it. */
  isTestTerminal: boolean;
  updatedAt: string | null;
};

export const UNCONFIGURED_CARDCOM: AdminCardcomConfig = {
  exists: false,
  terminalNumber: null,
  apiName: null,
  enabled: false,
  hasPassword: false,
  isTestTerminal: false,
  updatedAt: null,
};

export async function readCardcomAdminConfig(): Promise<AdminCardcomConfig> {
  await requirePlatformPermission('integrations.read');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cardcom_config')
    .select('terminal_number, api_name, enabled, api_password_secret, updated_at')
    .eq('id', true)
    .maybeSingle();

  // A read failure is reported as "not configured" rather than thrown: this feeds a status page, and a panel that
  // renders an error boundary because one card could not load is worse than one that says the provider is not set up.
  // A save still fails loudly, which is where it matters.
  if (error || !data) return UNCONFIGURED_CARDCOM;

  return {
    exists: true,
    terminalNumber: data.terminal_number,
    apiName: data.api_name,
    enabled: data.enabled,
    // The vault secret id collapses to a boolean HERE and is never returned.
    hasPassword: data.api_password_secret !== null,
    isTestTerminal: isCardcomTestTerminal(data.terminal_number),
    updatedAt: data.updated_at,
  };
}

export type SaveCardcomConfigResult = { ok: true } | { ok: false; reason: 'password_required' };

export async function saveCardcomConfig(input: {
  terminalNumber: number;
  apiName: string;
  /** '' means KEEP THE STORED PASSWORD (the database function's contract). */
  apiPassword: string;
  enabled: boolean;
}): Promise<SaveCardcomConfigResult> {
  const user = await requirePlatformPermission('integrations.manage');
  const admin = createAdminClient();

  // The database refuses to switch the pilot on without a password (a pilot that cannot refund must not run); this
  // looks first so the form can say why, in its own words, instead of passing on a constraint violation.
  if (input.enabled && input.apiPassword === '') {
    const { data, error } = await admin.from('cardcom_config').select('api_password_secret').eq('id', true).maybeSingle();
    if (error) throw error;
    if (!data || data.api_password_secret === null) return { ok: false, reason: 'password_required' };
  }

  const { error } = await admin.rpc('cardcom_config_save', {
    p_terminal_number: input.terminalNumber,
    p_api_name: input.apiName,
    p_api_password: input.apiPassword,
    p_enabled: input.enabled,
    // From the SESSION, never from the form: auth.uid() is NULL under the service role, so this is the only provenance.
    p_updated_by: user.id,
  });
  if (error) throw error;

  // No password, no secret id. Enough to answer "who changed the clearing configuration and when".
  await logActivity({
    action: 'admin.cardcom_config.saved',
    meta: { terminalNumber: input.terminalNumber, enabled: input.enabled, passwordSubmitted: input.apiPassword !== '' },
  });
  return { ok: true };
}
