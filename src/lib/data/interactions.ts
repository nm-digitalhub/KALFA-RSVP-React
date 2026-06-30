import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requireOwnedEvent } from '@/lib/data/events';
import { normalizePhone } from '@/lib/phone';
import type { Database } from '@/lib/supabase/types';

// Inbound webhook → contact_interactions plumbing (B2). All writes are
// service-role (the webhook is signature-verified, not session-authed). Never
// log the phone or payload.

type Channel = Database['public']['Enums']['campaign_channel'];
type OpStatus = Database['public']['Enums']['contact_op_status'];

export type InteractionRow = {
  event_id: string;
  campaign_id: string;
  contact_id: string;
  channel: Channel;
  direction: 'in' | 'out';
  kind: string;
  provider_id: string;
  billable: boolean;
  // The outbound wamid this inbound reply answered (Meta `context.id`). Links a
  // reply to the message that prompted it; optional (typed-back replies carry no
  // context). Only set on inbound rows.
  context_message_id?: string | null;
};

// Idempotent insert (UNIQUE(channel, provider_id)). Returns true only when THIS
// call inserted the row — so a Meta retry of the same event is a no-op and
// downstream billing runs at most once per provider event (§replay-safety).
export async function insertInteraction(row: InteractionRow): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contact_interactions')
    .upsert(row, { onConflict: 'channel,provider_id', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();
  if (error) throw new Error('שמירת האינטראקציה נכשלה');
  return data !== null;
}

// Resolve an inbound message (sender phone) to the (event, campaign, contact) it
// belongs to, via the most-recent PRIOR OUTBOUND interaction for that contact's
// normalized phone. contacts is unique on (event_id, phone) — a global phone is
// ambiguous, so the outbound interaction that targeted it disambiguates.
export async function resolveInboundContact(
  fromPhone: string,
): Promise<{ eventId: string; campaignId: string; contactId: string } | null> {
  const e164 = normalizePhone(fromPhone);
  if (!e164) return null;
  const admin = createAdminClient();

  const { data: contacts, error: cErr } = await admin
    .from('contacts')
    .select('id')
    .eq('normalized_phone', e164);
  if (cErr) throw new Error('טעינת אנשי הקשר נכשלה');
  const ids = (contacts ?? []).map((c) => c.id);
  if (ids.length === 0) return null;

  const { data, error } = await admin
    .from('contact_interactions')
    .select('event_id, campaign_id, contact_id')
    .in('contact_id', ids)
    .eq('direction', 'out')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('טעינת האינטראקציה נכשלה');
  if (!data || !data.event_id || !data.campaign_id || !data.contact_id) {
    return null;
  }
  return {
    eventId: data.event_id,
    campaignId: data.campaign_id,
    contactId: data.contact_id,
  };
}

// Resolve an inbound reply to its (event, campaign, contact) via the OUTBOUND
// interaction it answered — matched on Meta's `context.id`, which equals the
// outbound wamid we stored as provider_id. This is the precise, billable
// resolution path (no phone-based guessing): the reply is bound to the exact
// message we sent, so it can only bill a contact we actually targeted. Returns
// null when the context references no known outbound (fail-closed → no billing).
export async function resolveByContextId(
  contextId: string,
): Promise<{ eventId: string; campaignId: string; contactId: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contact_interactions')
    .select('event_id, campaign_id, contact_id')
    .eq('provider_id', contextId)
    .eq('direction', 'out')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('טעינת האינטראקציה לפי הקשר נכשלה');
  if (!data || !data.event_id || !data.campaign_id || !data.contact_id) {
    return null;
  }
  return {
    eventId: data.event_id,
    campaignId: data.campaign_id,
    contactId: data.contact_id,
  };
}

// Record the latest delivery state (sent/delivered/read/failed) + raw Meta error
// code onto the OUTBOUND interaction the status refers to (matched on the
// outbound wamid = provider_id). Non-billing, idempotent (last-write-wins).
// Returns the affected contact so callers can react to a definitive failure.
export async function setDeliveryStatus(
  messageId: string,
  status: string,
  errorCode: string | null,
): Promise<{ contactId: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contact_interactions')
    .update({ delivery_status: status, delivery_error_code: errorCode })
    .eq('channel', 'whatsapp')
    .eq('provider_id', messageId)
    .eq('direction', 'out')
    .select('contact_id')
    .maybeSingle();
  if (error) throw new Error('עדכון סטטוס המסירה נכשל');
  return { contactId: data?.contact_id ?? null };
}

export async function setContactOpStatus(
  contactId: string,
  status: OpStatus,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('contacts')
    .update({ op_status: status })
    .eq('id', contactId);
  if (error) throw new Error('עדכון סטטוס איש הקשר נכשל');
}

// D4: a removal/opt-out reply still BILLS (the human reach), THEN stops FUTURE
// outreach. Callers must run this AFTER recordReached so the billing RPC's
// removal guard can't block the reach that carries the removal. Sets the live
// `removal_requested` boolean (what listSendableContacts filters on); op_status
// is left to recordReached (`reached_billed`). Idempotent — re-setting is a
// no-op, so it is safe to run again on a deduped Meta retry.
export async function markContactRemovalRequested(
  contactId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('contacts')
    .update({ removal_requested: true })
    .eq('id', contactId);
  if (error) throw new Error('עדכון בקשת ההסרה נכשל');
}

// Return ALL guests linked to a contact within an event (id + name + RSVP
// token), oldest-first. A contact (one phone, deduped per event via
// contacts_event_phone_unique) can back MULTIPLE guests — guests.contact_id has
// NO uniqueness — so callers MUST handle the multi-guest case explicitly rather
// than assume one: the inbound RSVP path only auto-records when exactly one
// guest is behind the contact (never guesses an arbitrary one). Service-role
// (worker/admin context, no session). Never logs PII.
// GuestForContact is derived from the generated table type — never
// hand-maintained (the columns must track the real `guests` schema).
type GuestRow = Database['public']['Tables']['guests']['Row'];
export type GuestForContact = Pick<GuestRow, 'id' | 'full_name' | 'rsvp_token'>;

export async function getGuestsForContact(
  eventId: string,
  contactId: string,
): Promise<GuestForContact[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('guests')
    .select('id, full_name, rsvp_token')
    .eq('event_id', eventId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  if (error) throw new Error('טעינת האורחים נכשלה');
  return (data ?? []).map((g) => ({
    id: g.id,
    full_name: g.full_name,
    rsvp_token: g.rsvp_token,
  }));
}

// Best-effort, PII-free source marker: record that an RSVP was captured from a
// WhatsApp quick-reply button. Mirrors rsvp.ts recordRsvpAudit (direct
// service-role insert, user_id null, identifiers + status only — never names,
// notes, phone, or the token); logActivity is intentionally NOT reused because it
// calls requireUser(), and the webhook worker has no session. Fully swallowed: a
// marker failure must never fail the RSVP it annotates.
export async function recordRsvpFromWhatsapp(
  eventId: string,
  guestId: string,
  status: string,
): Promise<void> {
  type ActivityLogInsert =
    Database['public']['Tables']['activity_log']['Insert'];
  try {
    const admin = createAdminClient();
    const meta = { guest_id: guestId, status };
    const row: ActivityLogInsert = {
      event_id: eventId,
      user_id: null,
      action: 'rsvp.from_whatsapp',
      meta: meta as unknown as ActivityLogInsert['meta'],
    };
    await admin.from('activity_log').insert(row);
  } catch {
    // Deliberately swallowed: the marker is non-fatal and never logs PII.
  }
}

// ---------------------------------------------------------------------------
// B7: owner-facing reads for the guest-detail WhatsApp timeline.
//
// Everything ABOVE is webhook write-plumbing (service-role, signature-verified,
// no session). The two readers BELOW are different: they run on the OWNER's
// cookie client so RLS scopes every row to the owner's own events
// (`contact_interactions_owner_select` = event_id IS NOT NULL AND owns_event;
// `contacts_owner_select` = owns_event), and they re-verify ownership
// (requireOwnedEvent) as defense-in-depth — matching the data-layer idiom. Both
// are read-only and never select/return a message body or log PII.
// ---------------------------------------------------------------------------

// One timeline entry = one WhatsApp message. delivery_status is updated IN PLACE
// by setDeliveryStatus (last-write-wins), so an outbound row carries its CURRENT
// state (sent/delivered/read/failed), not a per-event stream. `payload_meta` is
// deliberately NOT selected — only PII-safe metadata reaches the UI.
export type ContactInteraction = {
  id: string;
  direction: 'in' | 'out';
  kind: string;
  delivery_status: string | null;
  delivery_error_code: string | null;
  provider_id: string;
  context_message_id: string | null;
  created_at: string;
};

// Timeline of WhatsApp interactions for one contact within an owned event,
// oldest-first (conversational order). Scoped by event_id (the owner RLS policy
// requires event_id IS NOT NULL) AND contact_id.
export async function listInteractionsForContact(
  eventId: string,
  contactId: string,
): Promise<ContactInteraction[]> {
  await requireOwnedEvent(eventId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contact_interactions')
    .select(
      'id, direction, kind, delivery_status, delivery_error_code, provider_id, context_message_id, created_at',
    )
    .eq('event_id', eventId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  if (error) throw new Error('טעינת היסטוריית האינטראקציות נכשלה');
  return (data ?? []).map((r) => ({
    id: r.id,
    direction: r.direction === 'in' ? 'in' : 'out',
    kind: r.kind,
    delivery_status: r.delivery_status,
    delivery_error_code: r.delivery_error_code,
    provider_id: r.provider_id,
    context_message_id: r.context_message_id,
    created_at: r.created_at,
  }));
}

export type GuestOutreachSummary = {
  contactId: string;
  opStatus: OpStatus;
  removalRequested: boolean;
};

// The guest's outreach state (op_status + opt-out) via its linked contact, plus
// the contact_id that drives listInteractionsForContact. Returns null when the
// guest has no contact (invalid/missing phone → not reachable, not billable).
// Two owner-scoped reads on the cookie client (RLS-gated).
export async function getGuestOutreachSummary(
  eventId: string,
  guestId: string,
): Promise<GuestOutreachSummary | null> {
  await requireOwnedEvent(eventId);
  const supabase = await createClient();

  const { data: guest, error: gErr } = await supabase
    .from('guests')
    .select('contact_id')
    .eq('event_id', eventId)
    .eq('id', guestId)
    .maybeSingle();
  if (gErr) throw new Error('טעינת המוזמן נכשלה');
  const contactId = guest?.contact_id ?? null;
  if (!contactId) return null;

  const { data: contact, error: cErr } = await supabase
    .from('contacts')
    .select('op_status, removal_requested')
    .eq('event_id', eventId)
    .eq('id', contactId)
    .maybeSingle();
  if (cErr) throw new Error('טעינת איש הקשר נכשלה');
  if (!contact) return null;

  return {
    contactId,
    opStatus: contact.op_status,
    removalRequested: contact.removal_requested,
  };
}
