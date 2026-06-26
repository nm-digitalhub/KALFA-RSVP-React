import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import { getTemplateByKey } from '@/lib/data/message-templates';
import { listSendableContacts } from '@/lib/data/contacts';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/client';

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

  const template = await getTemplateByKey(messageKey);
  if (!template || template.channel !== 'whatsapp') return { sent: 0, skipped: 0 };

  const contacts = await listSendableContacts(campaign.event_id);
  let sent = 0;
  let skipped = 0;
  for (const contact of contacts) {
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
      const { error: insErr } = await admin.from('contact_interactions').upsert(
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
      if (insErr) {
        skipped++;
        continue;
      }
      sent++;
    } catch {
      // A single send/log failure must not abort the batch. No PII logged.
      skipped++;
    }
  }
  return { sent, skipped };
}
