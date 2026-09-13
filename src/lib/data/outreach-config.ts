import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { resolveNumberForRoleStrict } from '@/lib/data/provider-numbers-resolve';
import {
  DEFAULT_SEND_POLICY,
  parseSendPolicy,
  type SendPolicy,
} from '@/lib/outreach/send-policy';

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

// The Israel send-timing policy (app_settings.whatsapp_send_policy jsonb).
// Fail-SAFE: a missing or invalid value resolves to the validated DEFAULT
// (never night/Shabbat sends) rather than throwing — an admin edit can only
// NARROW the window (parseSendPolicy enforces the ceilings).
export async function getSendPolicy(): Promise<SendPolicy> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.whatsapp_send_policy;
    if (raw == null) return DEFAULT_SEND_POLICY;
    return parseSendPolicy(raw);
  } catch {
    return DEFAULT_SEND_POLICY;
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

// The WhatsApp channel as the INBOUND ROUTER needs to see it: the send
// credentials above PLUS which of our business numbers (if any) is the
// dedicated guest-import number.
//
// Why this is a separate reader and not two more fields on WhatsAppConfig.
// The plan (§1.5.3 Task 3) called for widening WhatsAppConfig itself. Measured
// against the code that would pay for it: getWhatsAppConfig() runs ONCE PER
// RECIPIENT on the send path (outreach-engine.ts:398 and :724, inside the
// per-contact step delivery), so folding the role lookup into it would add a
// second round-trip per recipient — a 300-guest campaign would pay 300 of them
// for a field no send path reads. That is the same cost §1.5.2 forbids when it
// says the resolution "must be cached per-message-batch and not read once per
// message". So the widening is additive instead: only the router asks.
//
// The type gate the plan wanted is not lost, it moved: ChannelNumbers requires
// importPhoneNumberId, so a bare WhatsAppConfig does not structurally satisfy
// classifyInboundChannel's second parameter and tsc rejects it. Only this
// reader can feed the router.
export type WhatsAppChannel = WhatsAppConfig & {
  // The Meta phone_number_id of the import number (provider_numbers.provider_ref
  // of whoever holds `whatsapp_import_sender`). null = the role is unassigned →
  // legacy routing: the RSVP number also accepts lists and answers from itself.
  importPhoneNumberId: string | null;
  // The same number in E.164 (provider_numbers.e164), for the customer-facing
  // pointer and its wa.me link. Synced from Meta's display_phone_number.
  importDisplayNumber: string | null;
};

// Reads the role with the STRICT resolver on purpose: a read error must not
// read back as "unassigned", because unassigned routes every inbound row to the
// billing path. See resolveNumberForRoleStrict.
export async function getWhatsAppChannel(): Promise<WhatsAppChannel | null> {
  const config = await getWhatsAppConfig();
  if (!config) return null;

  const importNumber = await resolveNumberForRoleStrict('whatsapp_import_sender');
  const ref = importNumber?.providerRef ?? null;

  // Two ways the assignment is not usable, both resolving to legacy (today's
  // behaviour) rather than to a broken split:
  //   - a row with no Meta phone_number_id — there is nothing to route ON;
  //   - the RSVP number itself given the import role. One number cannot be
  //     both: honouring it would classify every RSVP reply as 'import' and
  //     stop billing entirely. The panel is where that mistake is visible.
  const usable = ref !== null && ref !== config.phoneNumberId;

  return {
    ...config,
    importPhoneNumberId: usable ? ref : null,
    importDisplayNumber: usable ? (importNumber?.e164 ?? null) : null,
  };
}

// Whether a WhatsApp send still requires a recorded contacts.whatsapp_consent_at.
// The admin switch app_settings.whatsapp_consent_required (channels UI) governs
// it — the exact twin of callConsentRequired() in outreach-engine.ts for the
// AI-call channel.
//
// FAIL-SAFE: anything but an explicit false — including a read error, a missing
// column before the migration lands, or a null row — reads as "required", so a
// hiccup can never silently drop the consent requirement and start sending to
// contacts who never gave one.
//
// Lifting the requirement skips ONLY the whatsapp_consent_at check. Opt-out
// (contacts.removal_requested) and the frozen campaign_authorized_contacts set
// are enforced separately and are never affected by this flag.
//
// Reads with `select('*')` deliberately, matching getOutreachEnabled above: the
// column is read defensively out of the row so this resolves to the SAFE value
// on a database that has not run the migration yet, instead of erroring.
export async function getWhatsAppConsentRequired(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return true;
    return (data as Record<string, unknown>).whatsapp_consent_required !== false;
  } catch {
    return true;
  }
}
