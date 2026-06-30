import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
  type WhatsAppConfig,
} from '@/lib/data/outreach-config';
import {
  getTemplateByKey,
  type ResolvedTemplate,
} from '@/lib/data/message-templates';
import { listSendableContacts } from '@/lib/data/contacts';
import { isPastEventDay } from '@/lib/data/event-date';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/client';

type AdminClient = ReturnType<typeof createAdminClient>;

// Send ONE approved WhatsApp template to ONE contact + log the outbound,
// non-billable interaction (idempotent on UNIQUE(channel, provider_id)). Returns
// whether it was sent. Never logs the token/phone/body. Shared by the batch
// send below AND the per-contact outreach engine (C1).
export async function sendOneWhatsApp(
  admin: AdminClient,
  campaign: { id: string; event_id: string },
  contact: { id: string; normalized_phone: string },
  template: ResolvedTemplate,
  config: WhatsAppConfig,
): Promise<boolean> {
  try {
    const { providerId } = await sendWhatsAppTemplate(
      {
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
        appSecret: config.appSecret,
      },
      {
        to: contact.normalized_phone,
        templateName: template.name,
        language: template.language,
      },
    );
    const { error } = await admin.from('contact_interactions').upsert(
      {
        event_id: campaign.event_id,
        campaign_id: campaign.id,
        contact_id: contact.id,
        channel: 'whatsapp',
        direction: 'out',
        kind: 'template',
        provider_id: providerId,
        billable: false,
      },
      { onConflict: 'channel,provider_id', ignoreDuplicates: true },
    );
    return !error;
  } catch {
    // A single send/log failure must not abort the batch. No PII logged.
    return false;
  }
}

// Send an approved WhatsApp template to a campaign's eligible contacts. Every
// §8.3 precondition is re-checked server-side BEFORE any provider call:
// outreach enabled + WhatsApp configured (fail-closed), campaign active,
// 'whatsapp' an allowed channel, a resolvable approved template, and per-contact
// eligibility (consent + not removal-requested, via listSendableContacts). Each
// successful send is logged as an OUTBOUND, non-billable contact_interaction
// (idempotent on the UNIQUE(channel, provider_id) webhook key). Never log the
// access token, recipient phone, or message body.
export async function sendCampaignWhatsApp(
  campaignId: string,
  messageKey: string,
): Promise<{ sent: number; skipped: number }> {
  if (!(await getOutreachEnabled())) return { sent: 0, skipped: 0 };
  const config = await getWhatsAppConfig();
  if (!config) return { sent: 0, skipped: 0 };

  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, event_id, status, allowed_channels')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !campaign) return { sent: 0, skipped: 0 };
  if (campaign.status !== 'active') return { sent: 0, skipped: 0 };
  if (!(campaign.allowed_channels ?? []).includes('whatsapp')) {
    return { sent: 0, skipped: 0 };
  }

  // L1: never send for an event whose day has already passed (Israel calendar).
  // R9: every commercial campaign action requires event.status='active' — app
  // defense-in-depth (campaign.status='active' here already structurally
  // implies it via the DB trigger + R7, but this is explicit per the plan's
  // "ALL commercial paths" requirement). event fields are read separately (the
  // campaign projection above omits them).
  const { data: ev } = await admin
    .from('events')
    .select('event_date, status')
    .eq('id', campaign.event_id)
    .maybeSingle();
  if (isPastEventDay(ev?.event_date ?? null)) return { sent: 0, skipped: 0 };
  if (ev?.status !== 'active') return { sent: 0, skipped: 0 };

  const template = await getTemplateByKey(messageKey);
  if (!template || template.channel !== 'whatsapp') return { sent: 0, skipped: 0 };

  // Bind outreach to the campaign's FROZEN authorized set: passing campaign.id
  // makes listSendableContacts INNER JOIN campaign_authorized_contacts, so a
  // send can never target a contact outside the set (reached ⊆ authorized).
  const contacts = await listSendableContacts(campaign.event_id, campaign.id);
  let sent = 0;
  let skipped = 0;
  for (const contact of contacts) {
    const ok = await sendOneWhatsApp(admin, campaign, contact, template, config);
    if (ok) sent++;
    else skipped++;
  }
  return { sent, skipped };
}
