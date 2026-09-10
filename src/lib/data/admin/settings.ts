import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isConfiguredServiceRoleKey } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';

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
  inquiry_followup_enabled: boolean; // reminder → warning → auto-close sweep on quiet inquiries
  agreement_archive_enabled: boolean; // nightly SharePoint archive of signed customer agreements
  signup_reminder_enabled: boolean; // daily one-shot "confirm your email" reminder to unconfirmed signups
  unconfirmed_cleanup_enabled: boolean; // daily deletion of signups still unconfirmed after 30 days
  // Below: columns the runtime already read but nothing could WRITE — they had
  // no admin control anywhere, so the only way to flip one was direct SQL.
  campaign_holds_enabled: boolean;
  billing_exposure_gate: boolean;
  monitor_enabled: boolean;
  inbound_calls_enabled: boolean;
  handoff_enabled: boolean;
  console_softphone_enabled: boolean;
  console_widget_enabled: boolean;
  console_manual_dial_enabled: boolean;
  console_wake_enabled: boolean;
  console_call_me_now_enabled: boolean;
  console_consult_conference_enabled: boolean;
  console_dtmf_handoff_enabled: boolean;
  updated_at: string;
};

const SETTINGS_ID = true;

export async function getAppSettings(): Promise<AppSettings> {
  await requirePlatformPermission('manage_settings');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'payments_enabled, close_charge_enabled, inquiry_followup_enabled, agreement_archive_enabled, signup_reminder_enabled, unconfirmed_cleanup_enabled, campaign_holds_enabled, billing_exposure_gate, monitor_enabled, inbound_calls_enabled, handoff_enabled, console_softphone_enabled, console_widget_enabled, console_manual_dial_enabled, console_wake_enabled, console_call_me_now_enabled, console_consult_conference_enabled, console_dtmf_handoff_enabled, updated_at',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת ההגדרות נכשלה');
  }

  return {
    payments_enabled: data?.payments_enabled ?? false,
    close_charge_enabled: data?.close_charge_enabled ?? false,
    inquiry_followup_enabled: data?.inquiry_followup_enabled ?? false,
    agreement_archive_enabled: data?.agreement_archive_enabled ?? false,
    signup_reminder_enabled: data?.signup_reminder_enabled ?? false,
    unconfirmed_cleanup_enabled: data?.unconfirmed_cleanup_enabled ?? false,
    campaign_holds_enabled: data?.campaign_holds_enabled ?? false,
    billing_exposure_gate: data?.billing_exposure_gate ?? false,
    monitor_enabled: data?.monitor_enabled ?? false,
    inbound_calls_enabled: data?.inbound_calls_enabled ?? false,
    handoff_enabled: data?.handoff_enabled ?? false,
    console_softphone_enabled: data?.console_softphone_enabled ?? false,
    console_widget_enabled: data?.console_widget_enabled ?? false,
    console_manual_dial_enabled: data?.console_manual_dial_enabled ?? false,
    console_wake_enabled: data?.console_wake_enabled ?? false,
    console_call_me_now_enabled: data?.console_call_me_now_enabled ?? false,
    console_consult_conference_enabled: data?.console_consult_conference_enabled ?? false,
    console_dtmf_handoff_enabled: data?.console_dtmf_handoff_enabled ?? false,
    updated_at: data?.updated_at ?? '',
  };
}

export type UpdateAppSettingsInput = {
  payments_enabled: boolean;
  close_charge_enabled: boolean;
  inquiry_followup_enabled: boolean;
  agreement_archive_enabled: boolean;
  signup_reminder_enabled: boolean;
  unconfirmed_cleanup_enabled: boolean;
  campaign_holds_enabled: boolean;
  billing_exposure_gate: boolean;
  monitor_enabled: boolean;
  inbound_calls_enabled: boolean;
  handoff_enabled: boolean;
  console_softphone_enabled: boolean;
  console_widget_enabled: boolean;
  console_manual_dial_enabled: boolean;
  console_wake_enabled: boolean;
  console_call_me_now_enabled: boolean;
  console_consult_conference_enabled: boolean;
  console_dtmf_handoff_enabled: boolean;
};

export async function updateAppSettings(
  input: UpdateAppSettingsInput,
): Promise<void> {
  await requirePlatformPermission('manage_settings');

  const supabase = await createClient();

  // The form is prefilled with the current values (masked), so every save
  // submits all fields. Empty → null (intentional unset).
  const { error } = await supabase
    .from('app_settings')
    .update({
      payments_enabled: input.payments_enabled,
      close_charge_enabled: input.close_charge_enabled,
      inquiry_followup_enabled: input.inquiry_followup_enabled,
      agreement_archive_enabled: input.agreement_archive_enabled,
      signup_reminder_enabled: input.signup_reminder_enabled,
      unconfirmed_cleanup_enabled: input.unconfirmed_cleanup_enabled,
      campaign_holds_enabled: input.campaign_holds_enabled,
      billing_exposure_gate: input.billing_exposure_gate,
      monitor_enabled: input.monitor_enabled,
      inbound_calls_enabled: input.inbound_calls_enabled,
      handoff_enabled: input.handoff_enabled,
      console_softphone_enabled: input.console_softphone_enabled,
      console_widget_enabled: input.console_widget_enabled,
      console_manual_dial_enabled: input.console_manual_dial_enabled,
      console_wake_enabled: input.console_wake_enabled,
      console_call_me_now_enabled: input.console_call_me_now_enabled,
      console_consult_conference_enabled: input.console_consult_conference_enabled,
      console_dtmf_handoff_enabled: input.console_dtmf_handoff_enabled,
    })
    .eq('id', SETTINGS_ID);

  if (error) {
    throw new Error('עדכון ההגדרות נכשל');
  }
}

// The base+overage pricing gate (app_settings.base_overage_pricing_enabled).
// Enabling turns on real ₪200 activation-fee billing for NEW campaigns — a
// money-path switch, so the ACTION layer fail-closes on the active agreement
// version + emits a security audit. This DAL is the gated writer only; the read
// for display goes through the fail-safe payments reader (getBaseOveragePricingEnabled).
export async function setBaseOveragePricingEnabled(
  enabled: boolean,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ base_overage_pricing_enabled: enabled })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון מתג התמחור המדורג נכשל');
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
  company_instagram_url: string;
};

const COMPANY_COLUMNS =
  'company_legal_name, company_legal_id, company_legal_address, company_contact_phone, company_contact_email, privacy_url, terms_url, warranty_text, company_instagram_url';

export async function getCompanySettings(): Promise<CompanySettings> {
  await requirePlatformPermission('manage_settings');
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
    company_instagram_url: data?.company_instagram_url ?? '',
  };
}

export async function updateCompanySettings(
  input: CompanySettings,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
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
      company_instagram_url: input.company_instagram_url || null,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון פרטי החברה נכשל');
}

// Exchange (Microsoft Graph — the IONOS-hosted mailbox's calendar, reached
// via Graph, not the retired EWS/SOAP path) ownership-model switch (plan
// §3.1, plans/exchange-ews-stage1.md). Admin-only write; the non-gated reader used
// by the connect screen itself is getExchangeConnectionMode() in
// src/lib/data/exchange-connections.ts (that module also documents WHY the
// reader must not require an admin permission — a non-admin user connecting
// their own mailbox still needs to know which mode is active).
export type ExchangeConnectionMode = 'per_user' | 'per_org';

export async function setExchangeConnectionMode(
  mode: ExchangeConnectionMode,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ exchange_connection_mode: mode })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון מצב הבעלות של Exchange נכשל');
}

// Infra config that legitimately stays in env (not editable via the form): the
// Supabase service-role key (the DB master credential — cannot live inside the
// DB it secures) and APP_ORIGIN (deploy infra). Presence only, never values.
export type InfraConfigItem = { key: string; label: string; configured: boolean };

export async function getInfraConfigStatus(): Promise<InfraConfigItem[]> {
  await requirePlatformPermission('manage_settings');

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

// ---------------------------------------------------------------------------
// Provider credentials — one reader/writer pair per provider (Task 0.2)
// ---------------------------------------------------------------------------
//
// These left appSettingsSchema and updateAppSettings so each provider gets its own
// FORM. The property that must hold, and that settings.test.ts pins: each writer
// touches ONLY its own columns, and updateAppSettings touches NONE of them. Two
// writers on one column is how a save in one screen silently reverts another.
//
// `configured` is derived here rather than by each caller. It is credentials ONLY —
// never the switch. Conflating them is what made the integrations panel report ExtrA
// as "not configured" whenever SMS was merely turned off.
//
// The masked-field convention is unchanged (owner ruling 2026-08-24): the reader
// returns the real secret because the form renders it masked with a reveal toggle,
// and '' on write is an intentional unset, not an empty string.

export type SumitCredentials = {
  sumit_company_id: string;
  sumit_api_public_key: string;
  sumit_api_key: string;
  configured: boolean;
};

export async function getSumitCredentials(): Promise<SumitCredentials> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('sumit_company_id, sumit_api_public_key, sumit_api_key')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת פרטי SUMIT נכשלה');
  return {
    sumit_company_id: data?.sumit_company_id ?? '',
    sumit_api_public_key: data?.sumit_api_public_key ?? '',
    sumit_api_key: data?.sumit_api_key ?? '',
    // The public key is not part of it: a clearing account works without one.
    configured: Boolean(data?.sumit_company_id && data?.sumit_api_key),
  };
}

export async function updateSumitCredentials(input: {
  sumit_company_id: string;
  sumit_api_public_key: string;
  sumit_api_key: string;
}): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      sumit_company_id: input.sumit_company_id || null,
      sumit_api_public_key: input.sumit_api_public_key || null,
      sumit_api_key: input.sumit_api_key || null,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון פרטי SUMIT נכשל');
}

export type ExtraSmsConfig = {
  sms_enabled: boolean;
  extra_sms_sender: string;
  extra_sms_token: string;
  configured: boolean;
};

export async function getExtraSmsConfig(): Promise<ExtraSmsConfig> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('sms_enabled, extra_sms_sender, extra_sms_token')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת הגדרות ה-SMS נכשלה');
  return {
    sms_enabled: data?.sms_enabled ?? false,
    extra_sms_sender: data?.extra_sms_sender ?? '',
    extra_sms_token: data?.extra_sms_token ?? '',
    // Credentials only — deliberately independent of sms_enabled.
    configured: Boolean(data?.extra_sms_token && data?.extra_sms_sender),
  };
}

export async function updateExtraSmsConfig(input: {
  sms_enabled: boolean;
  extra_sms_sender: string;
  extra_sms_token: string;
}): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      sms_enabled: input.sms_enabled,
      extra_sms_sender: input.extra_sms_sender || null,
      extra_sms_token: input.extra_sms_token || null,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון הגדרות ה-SMS נכשל');
}

export type EmailTransportConfig = {
  email_enabled: boolean;
  smtp_host: string;
  /** Text, because the form field is text; the column is an integer. */
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
  configured: boolean;
};

export async function getEmailTransportConfig(): Promise<EmailTransportConfig> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת הגדרות הדואר נכשלה');
  return {
    email_enabled: data?.email_enabled ?? false,
    smtp_host: data?.smtp_host ?? '',
    smtp_port: data?.smtp_port != null ? String(data.smtp_port) : '',
    smtp_secure: data?.smtp_secure ?? false,
    smtp_user: data?.smtp_user ?? '',
    smtp_password: data?.smtp_password ?? '',
    smtp_from: data?.smtp_from ?? '',
    // smtp_from is the one field BOTH transports need — Resend sends without a host.
    // Which transport is active is an env decision (EMAIL_PROVIDER) that belongs to
    // the page, not to a presence check.
    configured: Boolean(data?.smtp_from),
  };
}

export async function updateEmailTransportConfig(input: {
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
}): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      email_enabled: input.email_enabled,
      smtp_host: input.smtp_host || null,
      // parseInt, carried over from updateAppSettings: the column is an integer and
      // the form sends text. '' must become null, never NaN.
      smtp_port: input.smtp_port ? parseInt(input.smtp_port, 10) : null,
      smtp_secure: input.smtp_secure,
      smtp_user: input.smtp_user || null,
      smtp_password: input.smtp_password || null,
      smtp_from: input.smtp_from || null,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון הגדרות הדואר נכשל');
}
