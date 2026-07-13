import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isConfiguredServiceRoleKey } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/dal';

// Admin: the singleton app/system settings (operational toggle + admin-managed
// SUMIT clearing config). Authorized by requireAdmin() + the
// app_settings_admin_all RLS policy via the request-scoped session client.
//
// SECURITY NOTE: getAppSettings() returns the SUMIT keys (including the secret)
// so the admin form can show them masked with a reveal toggle — the common
// gateway-plugin pattern. They are sent ONLY to this admin-only page over HTTPS
// (requireAdmin), masked by default in the UI, and never logged.

export type AppSettings = {
  payments_enabled: boolean;
  close_charge_enabled: boolean; // master switch for the final close-charge (real money)
  sumit_company_id: string; // '' when unset (form-friendly)
  sumit_api_public_key: string; // '' when unset
  sumit_api_key: string; // '' when unset — shown masked + reveal in the admin form
  sms_enabled: boolean;
  extra_sms_sender: string; // '' when unset — verified sender identity in ExtrA
  extra_sms_token: string; // '' when unset — shown masked + reveal (secret)
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: string; // form-friendly string; coerced to int on save
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string; // '' when unset — masked + reveal (secret)
  smtp_from: string;
  updated_at: string;
};

const SETTINGS_ID = true;

export async function getAppSettings(): Promise<AppSettings> {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'payments_enabled, close_charge_enabled, sumit_company_id, sumit_api_public_key, sumit_api_key, sms_enabled, extra_sms_sender, extra_sms_token, email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from, updated_at',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת ההגדרות נכשלה');
  }

  return {
    payments_enabled: data?.payments_enabled ?? false,
    close_charge_enabled: data?.close_charge_enabled ?? false,
    sumit_company_id: data?.sumit_company_id ?? '',
    sumit_api_public_key: data?.sumit_api_public_key ?? '',
    sumit_api_key: data?.sumit_api_key ?? '',
    sms_enabled: data?.sms_enabled ?? false,
    extra_sms_sender: data?.extra_sms_sender ?? '',
    extra_sms_token: data?.extra_sms_token ?? '',
    email_enabled: data?.email_enabled ?? false,
    smtp_host: data?.smtp_host ?? '',
    smtp_port: data?.smtp_port != null ? String(data.smtp_port) : '',
    smtp_secure: data?.smtp_secure ?? false,
    smtp_user: data?.smtp_user ?? '',
    smtp_password: data?.smtp_password ?? '',
    smtp_from: data?.smtp_from ?? '',
    updated_at: data?.updated_at ?? '',
  };
}

export type UpdateAppSettingsInput = {
  payments_enabled: boolean;
  close_charge_enabled: boolean;
  sumit_company_id: string;
  sumit_api_public_key: string;
  sumit_api_key: string;
  sms_enabled: boolean;
  extra_sms_sender: string;
  extra_sms_token: string;
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
};

export async function updateAppSettings(
  input: UpdateAppSettingsInput,
): Promise<void> {
  await requireAdmin();

  const supabase = await createClient();

  // The form is prefilled with the current values (masked), so every save
  // submits all fields. Empty → null (intentional unset).
  const { error } = await supabase
    .from('app_settings')
    .update({
      payments_enabled: input.payments_enabled,
      close_charge_enabled: input.close_charge_enabled,
      sumit_company_id: input.sumit_company_id || null,
      sumit_api_public_key: input.sumit_api_public_key || null,
      sumit_api_key: input.sumit_api_key || null,
      sms_enabled: input.sms_enabled,
      extra_sms_sender: input.extra_sms_sender || null,
      extra_sms_token: input.extra_sms_token || null,
      email_enabled: input.email_enabled,
      smtp_host: input.smtp_host || null,
      smtp_port: input.smtp_port ? parseInt(input.smtp_port, 10) : null,
      smtp_secure: input.smtp_secure,
      smtp_user: input.smtp_user || null,
      smtp_password: input.smtp_password || null,
      smtp_from: input.smtp_from || null,
    })
    .eq('id', SETTINGS_ID);

  if (error) {
    throw new Error('עדכון ההגדרות נכשל');
  }
}

// --- Company / legal details (for the signed agreement) ---
// Admin-managed via the dedicated /admin/company screen; the agreement reads
// these live (§14ג mandatory disclosures + privacy/warranty). Not secret.
export type CompanySettings = {
  company_legal_name: string;
  company_legal_id: string;
  company_legal_address: string;
  company_contact_phone: string;
  company_contact_email: string;
  privacy_url: string;
  terms_url: string;
  warranty_text: string;
};

const COMPANY_COLUMNS =
  'company_legal_name, company_legal_id, company_legal_address, company_contact_phone, company_contact_email, privacy_url, terms_url, warranty_text';

export async function getCompanySettings(): Promise<CompanySettings> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(COMPANY_COLUMNS)
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת פרטי החברה נכשלה');
  return {
    company_legal_name: data?.company_legal_name ?? '',
    company_legal_id: data?.company_legal_id ?? '',
    company_legal_address: data?.company_legal_address ?? '',
    company_contact_phone: data?.company_contact_phone ?? '',
    company_contact_email: data?.company_contact_email ?? '',
    privacy_url: data?.privacy_url ?? '',
    terms_url: data?.terms_url ?? '',
    warranty_text: data?.warranty_text ?? '',
  };
}

export async function updateCompanySettings(
  input: CompanySettings,
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      company_legal_name: input.company_legal_name || null,
      company_legal_id: input.company_legal_id || null,
      company_legal_address: input.company_legal_address || null,
      company_contact_phone: input.company_contact_phone || null,
      company_contact_email: input.company_contact_email || null,
      privacy_url: input.privacy_url || null,
      terms_url: input.terms_url || null,
      warranty_text: input.warranty_text || null,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון פרטי החברה נכשל');
}

// Infra config that legitimately stays in env (not editable via the form): the
// Supabase service-role key (the DB master credential — cannot live inside the
// DB it secures) and APP_ORIGIN (deploy infra). Presence only, never values.
export type InfraConfigItem = { key: string; label: string; configured: boolean };

export async function getInfraConfigStatus(): Promise<InfraConfigItem[]> {
  await requireAdmin();

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appOrigin = process.env.APP_ORIGIN;

  return [
    {
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      label: 'מפתח שרת Supabase (נדרש לחיוב מהשרת)',
      configured: isConfiguredServiceRoleKey(serviceKey),
    },
    {
      key: 'APP_ORIGIN',
      label: 'מקור מורשה ל-CSRF (APP_ORIGIN)',
      configured: !!appOrigin,
    },
  ];
}
