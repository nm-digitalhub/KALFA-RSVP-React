import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Server-side readers of the admin-managed outreach config (app_settings, a
// singleton with ADMIN-ONLY RLS). Fail-safe AND forward-compatible: the columns
// are added by a pending migration, so until they exist `select('*')` simply
// omits them and these resolve to off / null (fail-closed — outreach stays off).
// Mirrors getCampaignHoldsEnabled. The access token / app secret never leave the
// server and are never logged.

export type WhatsAppConfig = {
  phoneNumberId: string;
  wabaId: string | null; // WhatsApp Business Account id — template CRUD node
  accessToken: string;
  appSecret: string | null; // only needed to verify inbound webhooks (B2)
  verifyToken: string | null; // webhook GET challenge (B2)
};

// Master switch for all outreach (WhatsApp + future channels). False unless on.
export async function getOutreachEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return (data as Record<string, unknown>).outreach_enabled === true;
  } catch {
    return false;
  }
}

// WhatsApp Cloud API config. Returns null unless BOTH the phone-number-id and the
// access token are present (the minimum to send). Read server-side only.
export async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const phoneNumberId =
      typeof row.whatsapp_phone_number_id === 'string'
        ? row.whatsapp_phone_number_id
        : '';
    const accessToken =
      typeof row.whatsapp_access_token === 'string'
        ? row.whatsapp_access_token
        : '';
    if (!phoneNumberId || !accessToken) return null;
    return {
      phoneNumberId,
      wabaId:
        typeof row.whatsapp_waba_id === 'string' ? row.whatsapp_waba_id : null,
      accessToken,
      appSecret:
        typeof row.whatsapp_app_secret === 'string'
          ? row.whatsapp_app_secret
          : null,
      verifyToken:
        typeof row.whatsapp_verify_token === 'string'
          ? row.whatsapp_verify_token
          : null,
    };
  } catch {
    return null;
  }
}
