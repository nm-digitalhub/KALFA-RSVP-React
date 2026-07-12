// One-off: send the approved brit INVITE WhatsApp template to a single late-added
// contact that was silently omitted from the campaign's frozen authorized set
// (docs/campaign-recipient-freeze-investigation-2026-07-09.md — scenario 1/2a).
//
// Reuses the app's real send path (sendOneWhatsApp + buildBodyParams + the
// event-type-aware template resolution) so the message is IDENTICAL to what the
// campaign sent — but bypasses listSendableContacts' authorized-set INNER JOIN,
// so it touches NO billing state (sendOneWhatsApp logs a NON-billable
// contact_interaction only). Out-of-band, transactional, one guest.
//
// Parameters come from the environment (NEVER hardcode a guest's phone or ids —
// this file is committed to a public repo). Provide them at run time, e.g.:
//   SEND_CAMPAIGN_ID=… SEND_EVENT_ID=… SEND_CONTACT_ID=… SEND_CONTACT_PHONE=+9725… \
//   node --env-file=.env.local dist/send-one-invite.cjs
//
// Run: bundle with esbuild (server-only/next aliased to empty) → node --env-file=.env.local

import { createAdminClient } from '@/lib/supabase/admin';
import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import { resolveTemplateForEvent } from '@/lib/data/message-templates';
import { resolveTemplateMedia, sendOneWhatsApp } from '@/lib/data/outreach';
import { buildBodyParams, deriveGuestFirstName } from '@/lib/whatsapp/template-spec';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const CAMPAIGN_ID = requireEnv('SEND_CAMPAIGN_ID');
const EVENT_ID = requireEnv('SEND_EVENT_ID');
const CONTACT_ID = requireEnv('SEND_CONTACT_ID');
const CONTACT_PHONE = requireEnv('SEND_CONTACT_PHONE');
const MESSAGE_KEY = process.env.SEND_MESSAGE_KEY ?? 'invite';

async function main() {
  if (!(await getOutreachEnabled())) throw new Error('outreach disabled');
  const config = await getWhatsAppConfig();
  if (!config) throw new Error('whatsapp not configured');

  const admin = createAdminClient();

  const { data: ev, error: evErr } = await admin
    .from('events')
    .select('event_date, status, name, event_type, venue_name, venue_address, celebrants, invite_image_path')
    .eq('id', EVENT_ID)
    .maybeSingle();
  if (evErr || !ev) throw new Error('event not found');
  if (ev.status !== 'active') throw new Error(`event not active: ${ev.status}`);

  const template = await resolveTemplateForEvent(MESSAGE_KEY, ev.event_type);
  if (!template || template.channel !== 'whatsapp') throw new Error('template unresolved');
  const family = template.name.startsWith('kalfa_wedding_') ? 'wedding' : 'generic';

  const media = await resolveTemplateMedia(template, ev.invite_image_path ?? null);
  const sendTemplate = media.template;

  const { data: guestRow } = await admin
    .from('guests')
    .select('full_name')
    .eq('event_id', EVENT_ID)
    .eq('contact_id', CONTACT_ID)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const firstName = deriveGuestFirstName(guestRow?.full_name ?? undefined);

  const built = buildBodyParams({
    paramContract: template.paramContract,
    family,
    ctx: { event: ev, guestFirstName: firstName },
  });
  if ('missing' in built) throw new Error(`params_incomplete: ${JSON.stringify(built.missing)}`);

  console.log(
    `[send-one] template=${sendTemplate.name} lang=${sendTemplate.language} ` +
      `params=${built.params.length} media=${media.headerImage ? 'yes' : 'no'} → sending…`,
  );

  const outcome = await sendOneWhatsApp(
    admin,
    { id: CAMPAIGN_ID, event_id: EVENT_ID },
    { id: CONTACT_ID, normalized_phone: CONTACT_PHONE },
    sendTemplate,
    config,
    MESSAGE_KEY,
    built.params,
    media.headerImage ? { headerImage: media.headerImage } : undefined,
  );

  console.log(`[send-one] outcome: ${outcome.kind}` +
    (outcome.kind === 'accepted' ? ` id=${outcome.providerId}` : ` reason=${'reason' in outcome ? outcome.reason : ''}`));
  if (outcome.kind !== 'accepted') process.exitCode = 1;
}

main().catch((e) => {
  console.error('[send-one] failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
