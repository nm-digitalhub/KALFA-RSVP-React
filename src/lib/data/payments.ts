import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Server-side readers of the admin-managed clearing config (app_settings, a
// singleton row with ADMIN-ONLY RLS). All reads go through the service-role
// client, so they NEVER run in the browser and the secret API key is never
// exposed to it. Every reader is fail-safe: on any error (including a missing /
// placeholder service-role key) it resolves to "off / not configured" rather
// than throwing — a customer page must never crash because clearing is unset.

export type SumitPublicConfig = { companyId: number; apiPublicKey: string };
export type SumitServerConfig = { companyId: number; apiKey: string };

// Master switch. False unless explicitly enabled.
export async function getPaymentsEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('payments_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return data.payments_enabled;
  } catch {
    return false;
  }
}

// Independent kill-switch for the route-A J5 campaign hold path (separate from
// the campaign payment switches). Fail-safe AND forward-compatible: the
// `campaign_holds_enabled` column is added by a pending migration, so until it
// exists `select('*')` simply omits it and this returns false (fail-closed — the
// hold form/route stay off). False unless the column exists AND is explicitly on.
export async function getCampaignHoldsEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return (data as Record<string, unknown>).campaign_holds_enabled === true;
  } catch {
    return false;
  }
}

// Master switch for the final close-CHARGE (capturing the held card for the
// accrued reached-contact total). Forward-compatible — false until the migration
// adds the column. Real money: charge only runs when this AND payments are on.
export async function getCloseChargeEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return (data as Record<string, unknown>).close_charge_enabled === true;
  } catch {
    return false;
  }
}

// Non-secret fields the browser legitimately needs for tokenization. Returned
// to the pay page and passed as props to the client PaymentForm.
export async function getSumitPublicConfig(): Promise<SumitPublicConfig | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('sumit_company_id, sumit_api_public_key')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const companyId = Number(data.sumit_company_id);
    if (!Number.isFinite(companyId) || companyId <= 0 || !data.sumit_api_public_key) {
      return null;
    }
    return { companyId, apiPublicKey: data.sumit_api_public_key };
  } catch {
    return null;
  }
}

// Secret server config for charging. Read only in the Route Handler, on the
// server, immediately before calling SUMIT. The api key never leaves the server.
export async function getSumitServerConfig(): Promise<SumitServerConfig | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('sumit_company_id, sumit_api_key')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const companyId = Number(data.sumit_company_id);
    if (!Number.isFinite(companyId) || companyId <= 0 || !data.sumit_api_key) {
      return null;
    }
    return { companyId, apiKey: data.sumit_api_key };
  } catch {
    return null;
  }
}
