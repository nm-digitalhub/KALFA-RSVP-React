import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

// Admin: guest-OUTREACH provider config (WhatsApp Cloud API; Voximplant ships
// with C2). Stored on the app_settings singleton (admin-only RLS). Secrets
// (access token, app secret) are returned to the admin form shown masked with a
// reveal toggle — the same gateway-plugin pattern as the SUMIT/SMTP keys in
// settings.ts. They are sent ONLY to this requireAdmin HTTPS page and never
// logged. `outreach_enabled` is the shared master switch for all channels.

export type WhatsAppChannelConfig = {
  outreach_enabled: boolean;
  whatsapp_phone_number_id: string; // '' when unset (form-friendly)
  whatsapp_waba_id: string; // '' when unset — WABA id (template CRUD node, not secret)
  whatsapp_access_token: string; // '' when unset — permanent System-User token
  whatsapp_app_secret: string; // '' when unset — webhook X-Hub-Signature-256
  whatsapp_verify_token: string; // '' when unset — webhook GET challenge
  configured: boolean; // derived: the minimum to send (phone id + token)
  // app_settings.whatsapp_consent_required — when false, a send skips the
  // contacts.whatsapp_consent_at check. Twin of voximplant's callConsentRequired.
  consentRequired: boolean;
};

const SETTINGS_ID = true;

export async function getWhatsAppChannelConfig(): Promise<WhatsAppChannelConfig> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'outreach_enabled, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_app_secret, whatsapp_verify_token, whatsapp_consent_required',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת הגדרות הערוץ נכשלה');

  const phoneNumberId = data?.whatsapp_phone_number_id ?? '';
  const accessToken = data?.whatsapp_access_token ?? '';
  return {
    outreach_enabled: data?.outreach_enabled ?? false,
    whatsapp_phone_number_id: phoneNumberId,
    whatsapp_waba_id: data?.whatsapp_waba_id ?? '',
    whatsapp_access_token: accessToken,
    whatsapp_app_secret: data?.whatsapp_app_secret ?? '',
    whatsapp_verify_token: data?.whatsapp_verify_token ?? '',
    configured: !!phoneNumberId && !!accessToken,
    // Fail-SAFE, exactly like the runtime reader: anything but an explicit
    // false shows as "required", so a missing row can never render the toggle
    // as already lifted.
    consentRequired: data?.whatsapp_consent_required !== false,
  };
}

// Admin toggle for the WhatsApp CONSENT gate
// (app_settings.whatsapp_consent_required). When required (the default, SAFE),
// a send needs a recorded contacts.whatsapp_consent_at — enforced in three
// places: the recipient query (sendable-contacts.ts), the per-contact gate and
// the terminal re-check (outreach-engine.ts). Setting it false lifts ONLY that
// check; opt-out (removal_requested), the frozen campaign_authorized_contacts
// set, and fail-closed reads still apply.
//
// Turning it off carries Israeli spam-law exposure surfaced at the toggle; the
// action layer audits every flip to Slack. Admin-only (RLS + manage_settings).
// Deliberately its OWN writer rather than a field on updateWhatsAppChannelConfig:
// a legal switch must not be flippable as a side effect of saving credentials.
export async function updateWhatsAppConsentRequired(
  required: boolean,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ whatsapp_consent_required: required })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון מתג ההסכמה לוואטסאפ נכשל');
}

export type UpdateWhatsAppChannelInput = {
  // NOTE: no `outreach_enabled` here — the shared global master switch is written
  // ONLY by the hoisted outreach-master action, never by this channel DAL.
  whatsapp_phone_number_id: string;
  whatsapp_waba_id: string;
  whatsapp_access_token: string;
  whatsapp_app_secret: string;
  whatsapp_verify_token: string;
};

export async function updateWhatsAppChannelConfig(
  input: UpdateWhatsAppChannelInput,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      whatsapp_phone_number_id: input.whatsapp_phone_number_id || null,
      whatsapp_waba_id: input.whatsapp_waba_id || null,
      whatsapp_access_token: input.whatsapp_access_token || null,
      whatsapp_app_secret: input.whatsapp_app_secret || null,
      whatsapp_verify_token: input.whatsapp_verify_token || null,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון הגדרות הערוץ נכשל');
}

export type ConnectionTestResult = { ok: boolean; message: string };

// Read-only WhatsApp credential check: GET the phone number's display number via
// the Graph API. Validates token + phone id WITHOUT sending a message. Never logs
// the token; returns a privacy-safe message.
export async function testWhatsAppConnection(): Promise<ConnectionTestResult> {
  await requirePlatformPermission('manage_settings');
  const cfg = await getWhatsAppChannelConfig();
  if (!cfg.configured) {
    return { ok: false, message: 'חסרים מזהה מספר או טוקן' };
  }
  // One pinned version for the whole system (G5). The former
  // WHATSAPP_GRAPH_VERSION env override is gone on purpose: it was never set
  // (verified 2026-09-09), and an override here could make the admin's "test
  // connection" pass on a version the send path does not use — the exact
  // false-confidence this check exists to prevent.
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
        cfg.whatsapp_phone_number_id,
      )}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${cfg.whatsapp_access_token}` } },
    );
    const body = (await res.json().catch(() => null)) as {
      display_phone_number?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok || !body || body.error) {
      return { ok: false, message: 'החיבור נכשל — בדקו את הטוקן והמזהה' };
    }
    return {
      ok: true,
      message: `מחובר${
        body.display_phone_number ? ` (${body.display_phone_number})` : ''
      }`,
    };
  } catch {
    return { ok: false, message: 'שגיאת תקשורת מול Meta' };
  }
}
