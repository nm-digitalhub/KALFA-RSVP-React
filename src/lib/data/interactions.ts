import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
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
