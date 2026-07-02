import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
  type WhatsAppConfig,
} from '@/lib/data/outreach-config';
import {
  resolveTemplateForEvent,
  type ResolvedTemplate,
} from '@/lib/data/message-templates';
import { listSendableContacts } from '@/lib/data/contacts';
import { isPastEventDay } from '@/lib/data/event-date';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/client';
import { buildTemplateParams } from '@/lib/whatsapp/template-spec';
import type { Database } from '@/lib/supabase/types';

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
  // Positional {{1}}..{{7}} values from buildTemplateParams — the callers
  // build them (fail-closed) and never pass a partial set.
  bodyParams?: readonly string[],
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
        bodyParams,
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

// The manual batch path below has no outreach_schedule touchpoint, but the
// sink's touchpoint_index is NOT NULL and part of the UNIQUE(campaign_id,
// touchpoint_index, reason) dedup key (a nullable index would break the dedup —
// Postgres treats NULLs as distinct). -1 is the documented sentinel: impossible
// as a real schedule index, and it dedups manual-path failures to one row per
// (campaign, reason).
export const MANUAL_SEND_TOUCHPOINT_INDEX = -1;

// Runtime template integrity (plan §5.6): a broken send input (missing/inactive
// template, channel mismatch, or event data too incomplete to bind the
// positional parameters) must never fail silently. This records it durably,
// deduplicated per (campaign, touchpoint, reason) via an atomic upsert — NOT
// select-then-insert, since the engine's claimStep advances a per-recipient
// cursor, so concurrent workers can hit the same broken touchpoint for
// different contacts at once. Shared by the engine (executeStep) and the
// manual batch path (sendCampaignWhatsApp, with the sentinel index above).
export async function recordTemplateFailure(
  admin: AdminClient,
  campaignId: string,
  touchpointIndex: number,
  reason: 'template_missing' | 'channel_mismatch' | 'params_incomplete',
  messageKey: string,
  channel: string,
): Promise<void> {
  // Touchpoint.channel (schedule.ts) is plain `string`, not the DB enum — the
  // schedule is validated upstream (packages admin form / campaigns snapshot)
  // to only ever contain real campaign_channel values, so this is a boundary
  // cast, not an unchecked one (same pattern as `as unknown as Json` elsewhere).
  const channelEnum = channel as Database['public']['Enums']['campaign_channel'];
  const { error } = await admin.from('outreach_template_failures').upsert(
    {
      campaign_id: campaignId,
      touchpoint_index: touchpointIndex,
      reason,
      message_key: messageKey,
      channel: channelEnum,
    },
    { onConflict: 'campaign_id,touchpoint_index,reason', ignoreDuplicates: true },
  );
  // The sink exists to make template failures visible — a failing sink write
  // must not be silent itself, but it must never break the step either (skip
  // semantics unchanged). Code/message only; no PII.
  if (error) {
    console.error('[outreach] template-failure sink write failed', error.code, error.message);
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
    .select('event_date, status, name, event_type, venue_name, venue_address, celebrants')
    .eq('id', campaign.event_id)
    .maybeSingle();
  if (isPastEventDay(ev?.event_date ?? null)) return { sent: 0, skipped: 0 };
  if (ev?.status !== 'active') return { sent: 0, skipped: 0 };

  // Same event-type-aware resolution as the engine (executeStep): the generic
  // row's components.variants may swap in the wedding-family template name.
  const template = await resolveTemplateForEvent(messageKey, ev.event_type);
  if (!template || template.channel !== 'whatsapp') return { sent: 0, skipped: 0 };
  // Which side of the Meta positional contract to bind — the wedding family
  // renders groom/bride in {{2}}/{{3}} (docs/whatsapp-templates-meta-submission.md).
  const family = template.name.startsWith('kalfa_wedding_') ? 'wedding' : 'generic';

  // Bind outreach to the campaign's FROZEN authorized set: passing campaign.id
  // makes listSendableContacts INNER JOIN campaign_authorized_contacts, so a
  // send can never target a contact outside the set (reached ⊆ authorized).
  const contacts = await listSendableContacts(campaign.event_id, campaign.id);

  // {{1}} source: ONE batched read (not per-contact) of the event's linked
  // guests, oldest-first so the first row seen per contact is the same
  // deterministic pick as the engine's `order created_at asc limit 1` (a
  // family can share one phone → several guests per contact).
  const guestNameByContact = new Map<string, string>();
  if (contacts.length > 0) {
    const { data: guestRows } = await admin
      .from('guests')
      .select('contact_id, full_name')
      .eq('event_id', campaign.event_id)
      .in('contact_id', contacts.map((c) => c.id))
      .order('created_at', { ascending: true });
    for (const g of guestRows ?? []) {
      if (g.contact_id && !guestNameByContact.has(g.contact_id)) {
        guestNameByContact.set(g.contact_id, g.full_name);
      }
    }
  }

  let sent = 0;
  let skipped = 0;
  // The missing-params verdict is event-level, not per-contact (only {{1}}
  // varies per contact, and it falls back) — so ONE durable sink record covers
  // the whole batch; the UNIQUE constraint dedups repeat runs anyway.
  let paramsFailureRecorded = false;
  for (const contact of contacts) {
    // First whitespace token of the linked guest's full_name; no guest → null
    // (buildTemplateParams falls back to the generic greeting for {{1}}).
    const firstName =
      guestNameByContact.get(contact.id)?.trim().split(/\s+/)[0] || null;
    const built = buildTemplateParams(family, {
      event: ev,
      guestFirstName: firstName,
    });
    if ('missing' in built) {
      // Fail-closed: never send a template with an empty positional parameter
      // (event data incomplete — e.g. no venue). Counted for the caller's
      // sent/skipped summary; nothing goes to the provider. Same §5.6 sink
      // wiring as the engine path (plan: "אותו חיווט גם במסלול הידני"), keyed
      // by the manual-path sentinel index.
      if (!paramsFailureRecorded) {
        paramsFailureRecorded = true;
        await recordTemplateFailure(
          admin,
          campaign.id,
          MANUAL_SEND_TOUCHPOINT_INDEX,
          'params_incomplete',
          messageKey,
          'whatsapp',
        );
      }
      skipped++;
      continue;
    }
    const ok = await sendOneWhatsApp(admin, campaign, contact, template, config, built.params);
    if (ok) sent++;
    else skipped++;
  }
  return { sent, skipped };
}
