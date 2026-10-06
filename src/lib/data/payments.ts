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
// the campaign payment switches). Fail-safe: reads the row with `select('*')`
// and returns false (fail-closed — the hold form/route stay off) unless
// `campaign_holds_enabled` is present AND explicitly on.
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
// accrued reached-contact total). Fail-closed — false unless `close_charge_enabled`
// is explicitly on. Real money: charge only runs when this AND payments are on.
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

// Gate for the flat-base + included + overage pricing model. FALSE
// (default) ⇒ new campaigns snapshot base/included = 0 (pure per-reached).
// Flip to TRUE only after agreement v4 + attorney sign-off — it activates base
// charging for NEW campaigns. Fail-closed: any read error ⇒ false (stay on the
// legacy per-reached model).
export async function getBaseOveragePricingEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return (data as Record<string, unknown>).base_overage_pricing_enabled === true;
  } catch {
    return false;
  }
}

// Gate for the fixed-price PACKAGE purchase (plan 2026-10-04-package-payment-plan.md, D9): a real charge
// at purchase, with no hold. FALSE (the column default) ⇒ the purchase route refuses every request.
// Fail-closed: only an explicit `true` opens it — any read error, absent row or
// non-boolean value keeps the purchase closed.
export async function getPackageModelEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('package_model_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return data.package_model_enabled === true;
  } catch {
    return false;
  }
}

// Non-secret fields the browser legitimately needs for tokenization. Returned
// to the pay page and passed as props to its client card form.
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

// Secret server config for charging. Read only on the server, immediately
// before calling SUMIT. The api key never leaves the server.
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
