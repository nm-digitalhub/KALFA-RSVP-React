import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';

// Agreement-document configuration tokens: the numeric/textual legal parameters
// injected into the signed agreement template (service-activation window, offer
// validity, charge window, hold-release period, liability cap, and data/record
// retention periods). NOT secret — disclosed inside the agreement itself.
// Admin-managed (the /admin/agreement/config screen); modelled on company/legal
// config (src/lib/data/company.ts + src/lib/data/admin/settings.ts) since both
// feed the same agreement. Storing them as admin DB config (not code constants)
// keeps the agreement free of hardcoded business facts.
//
// ONE camelCase vocabulary, two readers:
//   • getAgreementConfigTokens()   — live agreement read (service-role client).
//   • getAgreementConfigForAdmin() — admin-form prefill (session client + gate).
// Both return the SAME seven camelCase keys; the admin form, its Zod schema, and
// the writer in /admin/agreement/config all key off these names and map them to
// the snake_case agr_* columns on save.
//
// Token-key ↔ column mapping (THE CONTRACT consumers depend on; mirrors
// migration 202606290023_agreement_config.sql):
//   serviceActivationWindow → agr_service_activation_window
//   offerValidityDays       → agr_offer_validity_days
//   chargeWindowDays        → agr_charge_window_days
//   holdReleaseDays         → agr_hold_release_days
//   liabilityCap            → agr_liability_cap
//   retentionDays           → agr_retention_days
//   recordRetentionMonths   → agr_record_retention_months
//
// (Migration 202606290023 is applied + types regenerated, so the agr_* columns
// are type-checked against the schema.)

// The seven config values keyed by their camelCase token names. All strings
// ('' when unset). Structurally identical to the AgreementConfigForm `values`
// prop, so getAgreementConfigForAdmin() can feed the admin form directly.
export type AgreementConfigValues = {
  serviceActivationWindow: string;
  offerValidityDays: string;
  chargeWindowDays: string;
  holdReleaseDays: string;
  liabilityCap: string;
  retentionDays: string;
  recordRetentionMonths: string;
};

// Shape of the singleton row for the agreement-config columns. Each column is
// nullable text (default ''); the mapper coalesces null/undefined → ''.
type AgreementConfigRow = {
  agr_service_activation_window: string | null;
  agr_offer_validity_days: string | null;
  agr_charge_window_days: string | null;
  agr_hold_release_days: string | null;
  agr_liability_cap: string | null;
  agr_retention_days: string | null;
  agr_record_retention_months: string | null;
};

const SETTINGS_ID = true;

const AGREEMENT_CONFIG_COLUMNS =
  'agr_service_activation_window, agr_offer_validity_days, agr_charge_window_days, agr_hold_release_days, agr_liability_cap, agr_retention_days, agr_record_retention_months';

// Read the agreement-config columns from the app_settings singleton with the
// given client (service-role for the live agreement read; the request-scoped
// session client behind requireAdmin for the admin form). Returns null when the
// singleton row is missing; the mapper coalesces each field to ''.
async function readAgreementConfigRow(
  client: SupabaseClient<Database>,
): Promise<AgreementConfigRow | null> {
  const { data, error } = await client
    .from('app_settings')
    .select(AGREEMENT_CONFIG_COLUMNS)
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת הגדרות ההסכם נכשלה');
  }
  return (data ?? null) as AgreementConfigRow | null;
}

// Single source of the column → camelCase mapping (null/undefined → '').
function toAgreementConfigValues(
  row: AgreementConfigRow | null,
): AgreementConfigValues {
  return {
    serviceActivationWindow: row?.agr_service_activation_window ?? '',
    offerValidityDays: row?.agr_offer_validity_days ?? '',
    chargeWindowDays: row?.agr_charge_window_days ?? '',
    holdReleaseDays: row?.agr_hold_release_days ?? '',
    liabilityCap: row?.agr_liability_cap ?? '',
    retentionDays: row?.agr_retention_days ?? '',
    recordRetentionMonths: row?.agr_record_retention_months ?? '',
  };
}

// Live agreement read: the config tokens keyed by the camelCase token names the
// agreement template consumes. Read server-side via the service-role client (the
// agreement is built in the owner's context, not an admin's), mirroring
// getCompanyLegal in src/lib/data/company.ts. Returned as Record<string, string>
// (every value a string, '' when unset) so a token-map consumer can index it
// freely. The keys ARE the contract — do not rename without updating every
// consumer.
export async function getAgreementConfigTokens(): Promise<Record<string, string>> {
  const admin = createAdminClient();
  return toAgreementConfigValues(await readAgreementConfigRow(admin));
}

// Admin form prefill: the same seven values, keyed for the AgreementConfigForm
// `values` prop. Authorized by requireAdmin() + the app_settings_admin_all RLS
// policy via the request-scoped session client (NOT the service-role client —
// admin reads go through the cookie client + RLS), mirroring getCompanySettings.
export async function getAgreementConfigForAdmin(): Promise<AgreementConfigValues> {
  await requireAdmin();
  const supabase = await createClient();
  return toAgreementConfigValues(await readAgreementConfigRow(supabase));
}
