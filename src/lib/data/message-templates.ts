import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database, Json } from '@/lib/supabase/types';

// Resolve a campaign outreach_schedule `message_key` to the send-content the
// engine uses (WhatsApp: the Meta-approved template name + language; call: the
// script). Admin-managed (message_templates is admin-only RLS); the outreach
// reader uses the service-role client (RLS-bypassing). Only ACTIVE templates
// resolve — fail-closed, so a not-yet-configured key sends nothing.

type MessageTemplateRow = Database['public']['Tables']['message_templates']['Row'];

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

type EventType = Database['public']['Enums']['event_type'];

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
// mirroring variants). Scoped by event type ON PURPOSE — only variants whose
// approved Meta layout was VERIFIED to carry the 3 buttons are enabled, so a
// non-verified variant (e.g. wedding) never injects payloads Meta would reject.
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

// --- Admin management (/admin/templates) -----------------------------------

export type MessageTemplate = Pick<
  MessageTemplateRow,
  'id' | 'message_key' | 'channel' | 'label' | 'name' | 'language' | 'body' | 'active'
>;

const TEMPLATE_COLUMNS =
  'id, message_key, channel, label, name, language, body, active';

export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select(TEMPLATE_COLUMNS)
    .order('channel', { ascending: true })
    .order('message_key', { ascending: true });
  if (error) throw new Error('טעינת התבניות נכשלה');
  return (data ?? []) as MessageTemplate[];
}

export type UpdateMessageTemplateInput = {
  name: string;
  language: string;
  body: string;
  active: boolean;
};

// Admin edits the send-content + activation for one key (message_key/channel are
// fixed — they are referenced by the outreach schedule). Empty body → null.
export async function updateMessageTemplate(
  id: string,
  input: UpdateMessageTemplateInput,
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('message_templates')
    .update({
      name: input.name,
      language: input.language,
      body: input.body || null,
      active: input.active,
    })
    .eq('id', id);
  if (error) throw new Error('עדכון התבנית נכשל');
}
