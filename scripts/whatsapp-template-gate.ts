// Step-6 equivalence gate for the WhatsApp template data model
// (docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md):
//   npm run whatsapp:template-gate
//
// For every active WhatsApp step × every event type × image on/off, builds the
// full outgoing request TWICE against the LIVE database — the old way
// (message_templates.components + the code builders, i.e. what production sends
// today) and the new way (message_template_routes + whatsapp_template_parameters
// + the Meta mirror) — and compares template name, language, every body value,
// the header image, the URL-button suffix, quick-reply injection and endpoint.
// Exit code 1 on any difference. READ-ONLY: no send, no write.
//
// ⚠️ TEMPORARY MIGRATION SCAFFOLD — delete at step 7 together with the old path.

import { getTemplateByKey, resolveTemplateForEvent } from '@/lib/data/message-templates-resolve';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';
import { CELEBRANT_KIND_BY_EVENT_TYPE } from '@/lib/validation/schemas';
import { resolveWhatsAppSend } from '@/lib/data/whatsapp-template-send';
import {
  buildBodyParams,
  buildGiftParams,
  MARKETING_MESSAGE_KEYS,
} from '@/lib/whatsapp/template-spec';

type EventType = keyof typeof CELEBRANT_KIND_BY_EVENT_TYPE;

const CELEBRANTS_BY_KIND: Record<string, Json> = {
  couple: { groom: 'דוד לוי', bride: 'שרה כהן' },
  single: { name: 'איתי לוי' },
  parents: { parents: 'רון ומיכל כהן', child: 'אריאל', host_composition: 'couple' },
  free: { names: 'משפחת אברהם והחברים' },
};
const GUEST = 'דנה';
const GIFT_URL = 'https://pay.example/gift';
const GIFT_TOKEN = 'tok-123';
const IMAGE = 'invite/img.jpg';
const LEAD = { full_name: 'ישראל ישראלי', signup_ref: 'attempt-1' };

type Request = {
  name: string;
  language: string;
  body: readonly string[] | { missing: readonly string[] };
  headerImage: string | null;
  urlButton: string | null;
  quickReply: boolean;
  endpoint: 'marketing_messages' | 'messages';
};

function endpointFor(key: string): Request['endpoint'] {
  return MARKETING_MESSAGE_KEYS.has(key) ? 'marketing_messages' : 'messages';
}

async function oldRequest(key: string, eventType: EventType, withImage: boolean): Promise<Request | null> {
  if (key === 'sales_signup_link') {
    const t = await getTemplateByKey(key);
    if (!t) return null;
    return {
      name: t.name, language: t.language, body: [LEAD.full_name], headerImage: null,
      urlButton: LEAD.signup_ref, quickReply: false, endpoint: endpointFor(key),
    };
  }
  const r = await resolveTemplateForEvent(key, eventType);
  if (!r) return null;
  const media = withImage && !!r.mediaName;
  const name = media && r.mediaName ? r.mediaName : r.name;
  const celebrants = CELEBRANTS_BY_KIND[CELEBRANT_KIND_BY_EVENT_TYPE[eventType]];
  const built =
    key === 'gift'
      ? buildGiftParams({ event: { event_type: eventType, celebrants, gift_payment_url: GIFT_URL }, guestFirstName: GUEST })
      : buildBodyParams({
          paramContract: r.paramContract,
          family: name.startsWith('kalfa_wedding_') ? 'wedding' : 'generic',
          ctx: {
            event: {
              name: 'x', event_type: eventType, event_date: '2026-07-20T18:00:00+00:00',
              venue_name: 'אולמי הגן', venue_address: 'דרך השלום 10', celebrants,
            },
            guestFirstName: GUEST,
          },
        });
  return {
    name, language: r.language,
    body: 'params' in built ? built.params : { missing: built.missing },
    headerImage: media ? IMAGE : null,
    urlButton: key === 'gift' || key === 'event_day_pay' ? GIFT_TOKEN : null,
    quickReply: !!r.rsvpQuickReply,
    endpoint: endpointFor(key),
  };
}

async function main() {
  const admin = createAdminClient();
  const { data: steps } = await admin
    .from('message_templates').select('message_key').eq('channel', 'whatsapp').eq('active', true);
  if (!steps) throw new Error('failed to load gate data');

  let checked = 0;
  const diffs: string[] = [];
  for (const { message_key: key } of steps) {
    for (const eventType of Object.keys(CELEBRANT_KIND_BY_EVENT_TYPE) as EventType[]) {
      for (const withImage of [false, true]) {
        const oldReq = await oldRequest(key, eventType, withImage);
        // The NEW side is the production helper itself — the gate proves the
        // code that sends, not a copy of it.
        const resolved = await resolveWhatsAppSend({
          messageKey: key,
          eventType,
          inviteImagePath: withImage ? IMAGE : null,
          signImage: async (path) => path,
          values:
            key === 'sales_signup_link'
              ? { lead: LEAD }
              : {
                  event: {
                    event_type: eventType,
                    celebrants: CELEBRANTS_BY_KIND[CELEBRANT_KIND_BY_EVENT_TYPE[eventType]],
                    event_date: '2026-07-20T18:00:00+00:00', venue_name: 'אולמי הגן', venue_address: 'דרך השלום 10',
                    gift_payment_url: GIFT_URL, gift_link_token: GIFT_TOKEN,
                  },
                  guestFirstName: GUEST,
                },
        });
        let newReq: Request | null = null;
        if (resolved.kind === 'ok') {
          newReq = {
            name: resolved.template.name, language: resolved.template.language,
            body: resolved.bodyParams,
            headerImage: resolved.extras.headerImage?.link ?? null,
            urlButton: resolved.extras.urlButtonParam ?? null,
            quickReply: !!resolved.template.rsvpQuickReply,
            endpoint: endpointFor(key),
          };
        } else if (resolved.kind === 'params_incomplete') {
          newReq = { name: '?', language: '?', body: { missing: resolved.missing }, headerImage: null, urlButton: null, quickReply: false, endpoint: endpointFor(key) };
        }
        checked += 1;
        if (process.env.GATE_SAMPLE === `${key}/${eventType}/${withImage}`) {
          console.log('sample old:', JSON.stringify(oldReq));
          console.log('sample new:', JSON.stringify(newReq));
        }
        // Self-check of the gate: GATE_CORRUPT makes the NEW side wrong on purpose.
        if (newReq && process.env.GATE_CORRUPT === key) newReq = { ...newReq, quickReply: !newReq.quickReply };
        const a = JSON.stringify(oldReq);
        const b = JSON.stringify(newReq);
        if (a !== b) diffs.push(`${key} / ${eventType} / image=${withImage}\n  old: ${a}\n  new: ${b}`);
      }
    }
  }
  console.log(`checked ${checked} requests (${steps.length} steps × 9 event types × image on/off)`);
  if (diffs.length > 0) {
    console.log(`DIFFERENCES: ${diffs.length}\n${diffs.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('identical: 0 differences');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
