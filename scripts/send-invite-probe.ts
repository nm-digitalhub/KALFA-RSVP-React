// One-off verification probe: send the REAL RSVP invite template to ONE
// explicitly named contact through the REAL production send path, to prove
// that pinning GRAPH_API_VERSION (v25.0) did not break outbound WhatsApp.
//
// It does NOT re-implement the send. Every step below is the same function the
// campaign engine calls (src/lib/data/outreach-engine.ts:395-450):
//   getCampaignContext → resolveTemplateForEvent → deriveGuestFirstName →
//   buildBodyParams → resolveTemplateMedia → sendOneWhatsApp → client.ts
// The ONLY thing replaced is the scheduler that decides WHICH contact is due;
// the recipient is pinned by CLI argument so a probe can never fan out.
//
// Run (owner): npm run probe:invite -- --campaign <id> --contact <id> --confirm
// Without --confirm it stops after printing exactly what WOULD be sent.
//
// --from <phone_number_id> sends from a DIFFERENT business number on the same
// WABA (the token and app secret are WABA-wide, only the sender node changes).
// Used to prove the second business line can send at all; it does not change
// any stored configuration.
import { createAdminClient } from '@/lib/supabase/admin';
import { getCampaignContext } from '@/lib/data/outreach-engine';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { resolveTemplateForEvent } from '@/lib/data/message-templates-resolve';
import { resolveTemplateMedia, sendOneWhatsApp } from '@/lib/data/outreach';
import { buildBodyParams, deriveGuestFirstName } from '@/lib/whatsapp/template-spec';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

const MESSAGE_KEY = 'invite';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const campaignId = flag('campaign');
  const contactId = flag('contact');
  const confirmed = process.argv.includes('--confirm');
  if (!campaignId || !contactId) {
    throw new Error('usage: --campaign <id> --contact <id> [--confirm]');
  }

  console.log(`[probe] GRAPH_API_VERSION = ${GRAPH_API_VERSION}`);

  const admin = createAdminClient();

  const ctx = await getCampaignContext(campaignId);
  if (!ctx) throw new Error('campaign context not found');
  console.log(`[probe] campaign status=${ctx.status} channels=${ctx.allowed_channels.join(',')}`);

  const loaded = await getWhatsAppConfig();
  if (!loaded) throw new Error('WhatsApp is not configured (or outreach is off)');
  // Optional sender override — same WABA, same credentials, different business
  // number. Digits only, so a typo cannot be turned into an arbitrary URL path.
  const fromOverride = flag('from');
  if (fromOverride !== undefined && !/^[0-9]{5,25}$/.test(fromOverride)) {
    throw new Error('--from must be a numeric phone_number_id');
  }
  const config = fromOverride
    ? { ...loaded, phoneNumberId: fromOverride }
    : loaded;
  console.log(
    `[probe] sending phone_number_id=${config.phoneNumberId}${fromOverride ? ' (overridden)' : ''}`,
  );

  const { data: contact } = await admin
    .from('contacts')
    .select('id, normalized_phone, removal_requested')
    .eq('id', contactId)
    .eq('event_id', ctx.event_id)
    .maybeSingle();
  if (!contact) throw new Error('contact not found on this campaign event');
  if (contact.removal_requested) throw new Error('contact asked to be removed — refusing');
  // Business numbers are not guest PII, but this destination IS: print the
  // country code + last 3 only, enough to confirm the right person.
  const p = contact.normalized_phone;
  console.log(`[probe] to = ${p.slice(0, 5)}***${p.slice(-3)}`);

  const template = await resolveTemplateForEvent(MESSAGE_KEY, ctx.event.event_type);
  if (!template) throw new Error('template not resolved');
  console.log(`[probe] template=${template.name} lang=${template.language} channel=${template.channel} rsvpButtons=${template.rsvpQuickReply}`);

  const { data: guest } = await admin
    .from('guests')
    .select('full_name')
    .eq('event_id', ctx.event_id)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const guestFirstName = deriveGuestFirstName(guest?.full_name);

  const family = template.name.startsWith('kalfa_wedding_') ? 'wedding' : 'generic';
  const built = buildBodyParams({
    paramContract: template.paramContract,
    family,
    ctx: { event: ctx.event, guestFirstName },
  });
  if ('missing' in built) throw new Error(`params incomplete: ${built.missing.join(',')}`);
  console.log(`[probe] family=${family} params=${JSON.stringify(built.params)}`);

  const media = await resolveTemplateMedia(template, ctx.inviteImagePath);
  console.log(`[probe] resolved template=${media.template.name} headerImage=${media.headerImage ? 'yes' : 'no'}`);

  if (!confirmed) {
    console.log('[probe] DRY RUN — nothing sent. Re-run with --confirm to send.');
    return;
  }

  const outcome = await sendOneWhatsApp(
    admin,
    { id: campaignId, event_id: ctx.event_id },
    { id: contact.id, normalized_phone: contact.normalized_phone },
    media.template,
    config,
    MESSAGE_KEY,
    built.params,
    media.headerImage ? { headerImage: media.headerImage } : undefined,
  );

  console.log(`[probe] outcome = ${JSON.stringify(outcome)}`);
  if (outcome.kind !== 'accepted') process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[probe] failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
