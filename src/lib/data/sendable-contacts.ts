import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Request-free core of the "sendable contacts" read — the SAME service-role query
// used by the UI wrapper (listSendableContacts in contacts.ts) but with NO cookie
// / requireEventAccess gate, so it is safe from the pg-boss worker (the
// auto-thankyou sweep and the drip engine run in a long-lived process where
// next/headers is a no-op stub — cookies()/requireUser() would throw). It lives in
// its OWN module (not contacts.ts) so importing it never pulls contacts.ts →
// events.ts → auth/dal → next/headers|navigation into the worker bundle: the send
// path stays statically request-scoped-free (enforced by .dependency-cruiser.cjs).
//
// Contacts eligible for a WhatsApp send: not removal-requested AND with recorded
// WhatsApp consent. When a campaignId is given, membership is ADDITIONALLY bound
// to that campaign's frozen authorized set (campaign_authorized_contacts) via an
// INNER JOIN — so the outreach path can never target a contact outside the set:
// reached ⊆ authorized BY CONSTRUCTION (the Phase-2 money-leak guard, §7/0024).
// The no-campaign overload is kept for callers that predate the set.
//
// Authorization is the CALLER's responsibility when using this directly — the
// campaign send route/actions requireOwnedEvent first (their own boundary), and
// the worker sweep runs system-trusted with no user context. The DATA read is
// service-role either way; listSendableContacts (contacts.ts) wraps this with
// requireEventAccess for request-scoped (UI) callers, which is the ONLY difference.
// Mirrors outreach-engine.ts, which is deliberately request-free.
export async function resolveSendableContacts(
  eventId: string,
  campaignId?: string,
): Promise<Array<{ id: string; normalized_phone: string }>> {
  const admin = createAdminClient();

  if (campaignId) {
    // INNER JOIN the frozen authorized set: only contacts authorized for THIS
    // campaign survive (campaign_authorized_contacts.contact_id = contacts.id).
    const { data, error } = await admin
      .from('contacts')
      .select(
        'id, normalized_phone, campaign_authorized_contacts!inner(campaign_id)',
      )
      .eq('event_id', eventId)
      .eq('removal_requested', false)
      .not('whatsapp_consent_at', 'is', null)
      .eq('campaign_authorized_contacts.campaign_id', campaignId);
    if (error) throw new Error('טעינת אנשי הקשר לשליחה נכשלה');
    return (data ?? []).map((c) => ({
      id: c.id,
      normalized_phone: c.normalized_phone,
    }));
  }

  const { data, error } = await admin
    .from('contacts')
    .select('id, normalized_phone')
    .eq('event_id', eventId)
    .eq('removal_requested', false)
    .not('whatsapp_consent_at', 'is', null);
  if (error) throw new Error('טעינת אנשי הקשר לשליחה נכשלה');
  return (data ?? []).map((c) => ({
    id: c.id,
    normalized_phone: c.normalized_phone,
  }));
}
