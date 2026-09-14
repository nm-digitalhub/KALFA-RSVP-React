import 'server-only';

// Send an APPROVED WhatsApp template to one guest, from a workflow.
//
// ⚠️ WHY THIS FILE EXISTS AT ALL, given `sendWhatsAppReply` already sends
// WhatsApp. The two are not interchangeable, and the difference decides what an
// automation can do:
//
//   FREE TEXT (`sendWhatsAppReply`) is permitted only inside the 24-hour window
//     a guest's own message opens. Right for answering someone who just wrote —
//     which is what every RSVP flow does — and useless for reaching someone who
//     did not.
//
//   AN APPROVED TEMPLATE (this) may be sent at any time. It is therefore the
//     only thing a workflow started by a CLOCK can actually send, which is what
//     makes "two days after the event, thank everyone" expressible at all.
//
// ⚠️ AND IT REUSES THE CAMPAIGN PATH RATHER THAN REIMPLEMENTING IT. `sendOneWhatsApp`
// is the same function the outreach engine calls, so everything it enforces
// applies here unchanged and cannot drift:
//
//   * MARKETING templates route through MM Lite (`/marketing_messages`), which
//     Meta requires — a MARKETING key on `/messages` comes back 131055.
//   * The outbound interaction is logged with its `message_key`.
//   * The RSVP quick-reply payloads and the image-header sibling are resolved
//     by the same data-driven rules.
//
// A second implementation of any of that would be a second set of Meta rules to
// keep correct, and the first one to fall behind would fail silently.
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { resolveTemplateForEvent } from '@/lib/data/message-templates-resolve';
import { resolveTemplateMedia, sendOneWhatsApp } from '@/lib/data/outreach';
import { terminalReasonFor } from '@/lib/data/outreach-engine';
import { getWhatsAppConsentRequired } from '@/lib/data/outreach-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildBodyParams, deriveGuestFirstName } from '@/lib/whatsapp/template-spec';

export type TemplateSendResult = { ok: boolean; reason?: string };

/**
 * Send `messageKey`'s approved template to the contact.
 *
 * Every refusal is a NAMED reason rather than a throw, so the run log says which
 * gate stopped it — "no phone", "opted out", "template not approved for this
 * event type" are all things an owner can act on, and a bare failure is not.
 */
export async function sendTemplateToContact(input: {
  eventId: string;
  contactId: string;
  messageKey: string;
}): Promise<TemplateSendResult> {
  const admin = createAdminClient();

  const config = await getWhatsAppConfig();
  if (!config) return { ok: false, reason: 'whatsapp_not_configured' };

  // Everything the positional parameters need, in one read. `celebrants` and the
  // venue are what {{2}}–{{7}} are built from; a missing one fails CLOSED below
  // rather than sending a template with a blank in it.
  const { data: event } = await admin
    .from('events')
    .select('id, name, event_type, event_date, venue_name, venue_address, celebrants, invite_image_path')
    .eq('id', input.eventId)
    .maybeSingle();
  if (!event) return { ok: false, reason: 'event_not_found' };

  const { data: contact } = await admin
    .from('contacts')
    .select('id, normalized_phone, removal_requested, whatsapp_consent_at')
    .eq('id', input.contactId)
    .maybeSingle();
  if (!contact?.normalized_phone) return { ok: false, reason: 'no_phone_for_contact' };

  // ⚠️ THE SAME GATE THE CAMPAIGN USES, and deliberately not a copy of its rules.
  //
  // `terminalReasonFor` answers "may this contact be sent to on this channel",
  // and it READS THE LIVE SETTING rather than assuming one — so with
  // `whatsapp_consent_required` off (its state on 2026-09-13, by the owner's
  // decision) a missing consent does not block, and the day it is switched back
  // on this node obeys immediately with no code change.
  //
  // `removal_requested` blocks regardless of that switch, on every channel.
  // Someone who asked to be removed is not a setting.
  const blocked = terminalReasonFor(
    contact,
    'whatsapp',
    await getWhatsAppConsentRequired(),
  );
  if (blocked) return { ok: false, reason: blocked };

  const template = await resolveTemplateForEvent(input.messageKey, event.event_type);
  if (!template) return { ok: false, reason: 'template_not_available' };

  // The guest behind the contact, for {{1}}. `deriveGuestFirstName` is the shared
  // rule — first token, and null for a household ("משפחת כהן") so the greeting
  // falls back to the generic form instead of "שלום משפחת,".
  const { data: guest } = await admin
    .from('guests')
    .select('full_name')
    .eq('event_id', input.eventId)
    .eq('contact_id', input.contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Which side of Meta's positional contract to bind. The same expression the
  // outreach engine uses — the wedding family renders groom/bride in {{2}}/{{3}}.
  const family = template.name.startsWith('kalfa_wedding_') ? 'wedding' : 'generic';
  const built = buildBodyParams({
    paramContract: template.paramContract,
    family,
    ctx: { event, guestFirstName: deriveGuestFirstName(guest?.full_name) },
  });
  if ('missing' in built) {
    // FAIL CLOSED. A template sent with an empty positional parameter reaches a
    // guest with a hole in the sentence, and Meta may reject it outright. The
    // missing keys are event-level data, never guest data, so naming them is
    // both safe and the only way an owner can fix it.
    return { ok: false, reason: `params_incomplete:${built.missing.join(',')}` };
  }

  // The IMAGE-header sibling when the row maps one AND the event has an uploaded
  // invitation — fail-open to the text template, same as every other send path.
  const media = await resolveTemplateMedia(template, event.invite_image_path ?? null);

  // The event's campaign, for the interaction log only. One campaign per event
  // is the product's own rule; without one the send still happens and only the
  // log row is skipped, because a missing campaign is not a reason to withhold a
  // message an owner asked for.
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id')
    .eq('event_id', input.eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const outcome = await sendOneWhatsApp(
    admin,
    { id: campaign?.id ?? '', event_id: input.eventId },
    { id: contact.id, normalized_phone: contact.normalized_phone },
    media.template,
    config,
    input.messageKey,
    built.params,
    // `resolveTemplateMedia` returns the header image alongside the (possibly
    // swapped) template; `urlButtonParam` belongs to the gift template only and
    // is not a shape this node builds.
    media.headerImage ? { headerImage: media.headerImage } : undefined,
  );

  // 'accepted' is Meta TAKING the message — not delivery, and never a read
  // receipt. Anything else is reported by its classification so the log
  // distinguishes "refused" from "we do not know".
  return outcome.kind === 'accepted'
    ? { ok: true }
    : { ok: false, reason: outcome.kind };
}
