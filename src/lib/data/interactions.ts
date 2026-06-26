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
