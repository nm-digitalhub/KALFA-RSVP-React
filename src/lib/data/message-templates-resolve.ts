import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Enums, Json, Tables } from '@/lib/supabase/types';
// Request-free CORE of template resolution — the campaign outreach engine's
// internal template readers (service-role, read-only, active-only). It lives in
// its OWN module (not message-templates.ts) so the worker send path can import it
// WITHOUT pulling message-templates.ts's admin wrappers (listMessageTemplates /
// updateMessageTemplate → requireAdmin from @/lib/auth/dal + the request-scoped
// @/lib/supabase/server createClient → next/headers|navigation) into the worker
// bundle. The worker (auto-thankyou sweep + drip engine) runs in a long-lived
// process where next/headers is a no-op stub, so it must stay request-free
// (enforced by .dependency-cruiser.cjs). Authorization for these readers is
// intentionally NONE — they are non-admin, active-only reads; the admin surface
// lives in message-templates.ts and IS gated.

type MessageTemplateRow = Tables<'message_templates'>;

export type ResolvedTemplate = Pick<MessageTemplateRow, 'name' | 'language' | 'channel'> & {
  // Optional IMAGE-header sibling template (components.media_variant, admin
  // data). Send paths switch to it ONLY when the event actually has an
  // uploaded invitation image — otherwise the text template is used as-is.
  mediaName?: string | null;
  // True when the resolved template carries the 3 RSVP QUICK_REPLY buttons FOR
  // THIS event type (components.rsvp_quick_reply[eventType], admin data) → the send
  // injects the rsvp_* payloads so a tap returns button.payload='rsvp_*'.
  rsvpQuickReply?: boolean;
  // Which positional-parameter contract the send path binds for THIS event type
  // (components.param_contract[eventType], admin data). Absent → the standard
  // generic/wedding 7-tuple; 'brit_trad_invite' / 'brit_trad_reminder' select
  // the personal first-person builders. Data-driven so a new layout is one jsonb
  // entry, not another code-side name test.
  paramContract?: string | null;
};

export async function getTemplateByKey(
  messageKey: string,
): Promise<ResolvedTemplate | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('message_templates')
    .select('name, language, channel')
    .eq('message_key', messageKey)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.name || !data.language || !data.channel) return null;
  return { name: data.name, language: data.language, channel: data.channel };
}

// --- Event-type variant resolution ------------------------------------------

type EventType = Enums<'event_type'>;

// The `components` jsonb may carry a data-driven variant mapping (set by an
// admin, e.g. `{"variants": {"wedding": "kalfa_wedding_invite_v1"}}`) that
// swaps the Meta template NAME per event type — same language/channel, same
// positional-parameter contract (docs/whatsapp-templates-meta-submission.md).
// `components` is untyped Json, so walk it defensively: anything malformed or
// missing simply means "no variant" and the generic row is used — never throw.
function variantNameFor(components: Json | null, eventType: EventType): string | null {
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    return null;
  }
  const variants = (components as { [key: string]: Json | undefined }).variants;
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
    return null;
  }
  const name = (variants as { [key: string]: Json | undefined })[eventType];
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

// The IMAGE-header sibling template name: a per-event-type mapping
// (components.media_variants[eventType], e.g. a brit-specific media wording)
// wins over the global components.media_variant fallback. Same defensive walk
// as variantNameFor — anything malformed simply means "no media".
function mediaVariantNameFor(
  components: Json | null,
  eventType: EventType,
): string | null {
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    return null;
  }
  const map = (components as { [key: string]: Json | undefined }).media_variants;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const perType = (map as { [key: string]: Json | undefined })[eventType];
    if (typeof perType === 'string' && perType.trim() !== '') return perType;
  }
  const name = (components as { [key: string]: Json | undefined }).media_variant;
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

// Whether the RSVP quick-reply buttons are enabled for THIS event type (admin
// data: components.rsvp_quick_reply is a per-event-type map, e.g. {"brit": true},
// mirroring variants). Scoped by event type so a variant whose approved Meta
// layout does NOT carry the 3 buttons never injects payloads Meta would reject.
//
// The flag being OFF is NOT cosmetic: without the injected payloads a tap comes
// back as button.payload = the Hebrew LABEL ("מגיע/ה"), RSVP_BUTTON_MAP misses
// it, and the guest stays "pending" while believing they answered.
//
// The layout gate is now MEASURED, not assumed. Verified against Meta 2026-09-08
// (GET /{waba}/message_templates?fields=components) — every one of these carries
// the SAME 3 QUICK_REPLY buttons in the SAME order as RSVP_QUICK_REPLY
// (מגיע/ה · לא מגיע/ה · אולי), all APPROVED: kalfa_event_invite_v2,
// kalfa_event_invite_media_v1, kalfa_event_reminder_v1, kalfa_event_reminder2_v1,
// kalfa_event_final_v1, kalfa_brit_invite_trad_v4. So there is no longer a
// layout reason to withhold the flag from the non-brit event types; what gates
// them is the admin jsonb, which still reads {"brit": true} on all four
// button-bearing rows (invite, reminder_1, reminder_2, final).
//
// Defensive walk like variantNameFor — anything malformed/absent means "off".
function rsvpQuickReplyFlag(components: Json | null, eventType: EventType): boolean {
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    return false;
  }
  const map = (components as { [key: string]: Json | undefined }).rsvp_quick_reply;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return false;
  }
  return (map as { [key: string]: Json | undefined })[eventType] === true;
}

// Which positional-parameter contract to bind for THIS event type
// (components.param_contract[eventType], admin data, e.g. {"brit":"brit_trad_invite"}).
// Absent/malformed → null (the standard generic/wedding tuple). Same defensive
// walk as variantNameFor — a bad value degrades to the default, never throws.
function paramContractFor(components: Json | null, eventType: EventType): string | null {
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    return null;
  }
  const map = (components as { [key: string]: Json | undefined }).param_contract;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return null;
  }
  const value = (map as { [key: string]: Json | undefined })[eventType];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

// getTemplateByKey + per-event-type variant selection. Resolution of the row
// itself is identical (active-only, fail-closed → null); the variant mapping
// only ever replaces the template NAME, so a missing/malformed mapping
// degrades to the generic family, not to a send failure.
export async function resolveTemplateForEvent(
  messageKey: string,
  eventType: EventType,
): Promise<ResolvedTemplate | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('message_templates')
    .select('name, language, channel, components')
    .eq('message_key', messageKey)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.name || !data.language || !data.channel) return null;
  const variant = variantNameFor(data.components, eventType);
  return {
    name: variant ?? data.name,
    language: data.language,
    channel: data.channel,
    mediaName: mediaVariantNameFor(data.components, eventType),
    rsvpQuickReply: rsvpQuickReplyFlag(data.components, eventType),
    paramContract: paramContractFor(data.components, eventType),
  };
}
