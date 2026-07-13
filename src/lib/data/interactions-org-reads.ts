import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireEventAccess } from '@/lib/data/events';
import type { Database } from '@/lib/supabase/types';

type OpStatus = Database['public']['Enums']['contact_op_status'];

// ---------------------------------------------------------------------------
// Org-aware reads for the guest-detail WhatsApp timeline.
//
// These run on the member's cookie client so RLS scopes every row to the event
// org (`contact_interactions_org_select`, `contacts_org_select`), and they
// re-verify access via requireEventAccess (contacts.view) as defense-in-depth.
// Both are read-only and never select/return a message body or log PII.
//
// They live in their OWN module (split out of interactions.ts) because they are
// the ONLY request-scoped (cookie/requireEventAccess) functions in the outreach
// interactions layer — keeping them here means the request-FREE interactions.ts
// (webhook write-plumbing + billing/worker readers, service-role) never drags
// events.ts → auth/dal → next/headers|navigation into the pg-boss worker bundle
// (enforced by .dependency-cruiser.cjs). Behavior is byte-identical to before
// the split; only the file location changed.
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

// Timeline of WhatsApp interactions for one contact within an event the member
// may view, oldest-first (conversational order). Scoped by event_id AND
// contact_id; RLS + the gate authorize org members holding contacts.view.
export async function listInteractionsForContact(
  eventId: string,
  contactId: string,
): Promise<ContactInteraction[]> {
  await requireEventAccess(eventId, 'contacts', 'view');
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
// Two org-aware reads on the cookie client (RLS-gated).
export async function getGuestOutreachSummary(
  eventId: string,
  guestId: string,
): Promise<GuestOutreachSummary | null> {
  await requireEventAccess(eventId, 'contacts', 'view');
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
