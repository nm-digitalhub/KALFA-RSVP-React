import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';

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
};

const SETTINGS_ID = true;

export async function getWhatsAppChannelConfig(): Promise<WhatsAppChannelConfig> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'outreach_enabled, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_app_secret, whatsapp_verify_token',
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
  };
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
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(
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
