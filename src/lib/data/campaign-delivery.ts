import 'server-only';

import { requireOwnedEvent } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

// B8 — the WhatsApp/Meta webhook breakdown for a campaign, shown BESIDE (never
// replacing) the existing billing summary on the campaign board. Every figure is
// a reflection of an inbound Meta signal:
//   - `delivery_status` (sent/delivered/read/failed) from the status callbacks,
//   - `op_status` (reached_billed / wrong_number) from the contact's outcome,
//   - `removal_requested` from an opt-out reply.
// Owner-scoped: all reads go through the cookie client (owner RLS, owns_event)
// and the campaign's event ownership is re-asserted (defense-in-depth). The
// billing summary (reached/accrued/ceiling) is a separate RPC and is untouched.

type OpStatus = Database['public']['Enums']['contact_op_status'];

export type CampaignDeliveryBreakdown = {
  // Distinct contacts targeted by the campaign (the denominator for every bucket).
  totalContacts: number;
  // Message delivery as a CUMULATIVE funnel, counted per contact by their most-
  // recent outbound message's state. WhatsApp delivery is monotonic
  // (read ⊆ delivered ⊆ sent), so each earlier stage includes the later ones:
  // sent ≥ delivered ≥ read. `failed` is a separate terminal bucket. Every count
  // is a per-stage reach ≤ totalContacts (NOT summed across stages).
  delivery: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  };
  // Contact-level outcomes derived from the contact record.
  outcome: {
    reached: number; // op_status = 'reached_billed' (a human reach)
    wrongNumber: number; // op_status = 'wrong_number'
    optedOut: number; // removal_requested = true (independent of op_status)
  };
};

// Enum-typed constants so a renamed contact_op_status value becomes a compile
// error here rather than a silently-miscounted bucket.
const REACHED: OpStatus = 'reached_billed';
const WRONG_NUMBER: OpStatus = 'wrong_number';

// Pure aggregation — kept separate from the fetch so it is unit-testable without a
// database. `interactions` are the campaign's OUTBOUND rows; `contacts` are the
// distinct campaign contacts (already resolved + RLS-scoped by the caller).
export function aggregateDeliveryBreakdown(
  interactions: ReadonlyArray<{
    contact_id: string | null;
    delivery_status: string | null;
    created_at: string;
  }>,
  contacts: ReadonlyArray<{ op_status: OpStatus; removal_requested: boolean }>,
): CampaignDeliveryBreakdown {
  // The most-recent outbound message per contact. Each message row holds only its
  // latest delivery state (setDeliveryStatus is last-write-wins per provider_id),
  // so the newest message's state is taken as the contact's current delivery state.
  const latestByContact = new Map<string, { delivery_status: string | null; at: number }>();
  for (const i of interactions) {
    if (!i.contact_id) continue; // unattributed sends don't count toward a contact
    const at = Date.parse(i.created_at);
    const prev = latestByContact.get(i.contact_id);
    if (!prev || at > prev.at) {
      latestByContact.set(i.contact_id, { delivery_status: i.delivery_status, at });
    }
  }

  // Cumulative funnel: a 'read' contact also counts as delivered + sent, etc., so
  // the bars read as "contacts who reached this stage" (sent ≥ delivered ≥ read).
  // 'failed' is terminal and stands alone; null/unknown = no Meta-confirmed stage.
  const delivery = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const { delivery_status } of latestByContact.values()) {
    switch (delivery_status) {
      case 'read':
        delivery.read += 1;
        delivery.delivered += 1;
        delivery.sent += 1;
        break;
      case 'delivered':
        delivery.delivered += 1;
        delivery.sent += 1;
        break;
      case 'sent':
        delivery.sent += 1;
        break;
      case 'failed':
        delivery.failed += 1;
        break;
      default:
        break; // null / not-yet-acknowledged → no delivery stage yet
    }
  }

  const outcome = { reached: 0, wrongNumber: 0, optedOut: 0 };
  for (const c of contacts) {
    if (c.removal_requested) outcome.optedOut += 1;
    if (c.op_status === REACHED) outcome.reached += 1;
    else if (c.op_status === WRONG_NUMBER) outcome.wrongNumber += 1;
  }

  return { totalContacts: contacts.length, delivery, outcome };
}

// Owner-gated reader. Returns null only when the campaign isn't visible to the
// caller (RLS) — the page already establishes ownership, so this is belt-and-
// suspenders; on the happy path it returns an all-zeros breakdown until the
// outreach engine starts producing webhook signals. Batched (never N+1):
// one read each for the outbound interactions, the engine state, and the
// contacts — no per-contact round-trips.
export async function getCampaignDeliveryBreakdown(
  campaignId: string,
): Promise<CampaignDeliveryBreakdown | null> {
  const supabase = await createClient();

  // Resolve the campaign's event under owner RLS; a non-owner sees null.
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('event_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (cErr) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign?.event_id) return null;
  await requireOwnedEvent(campaign.event_id); // defense-in-depth ownership gate

  // Outbound delivery rows for the campaign — also seeds part of the contact set.
  const { data: interactions, error: iErr } = await supabase
    .from('contact_interactions')
    .select('contact_id, delivery_status, created_at')
    .eq('campaign_id', campaignId)
    .eq('direction', 'out');
  if (iErr) throw new Error('טעינת נתוני המסירה נכשלה');

  // The engine tracks every targeted contact in outreach_state, including those
  // not yet messaged — union it with the messaged contacts for the full set.
  const { data: states, error: sErr } = await supabase
    .from('outreach_state')
    .select('contact_id')
    .eq('campaign_id', campaignId);
  if (sErr) throw new Error('טעינת מצב הפנייה נכשלה');

  const contactIds = Array.from(
    new Set(
      [...(interactions ?? []), ...(states ?? [])]
        .map((r) => r.contact_id)
        .filter((id): id is string => id != null),
    ),
  );

  // Outcome (op_status + opt-out) for the campaign's contacts — one batched query.
  let contacts: { op_status: OpStatus; removal_requested: boolean }[] = [];
  if (contactIds.length > 0) {
    const { data, error } = await supabase
      .from('contacts')
      .select('op_status, removal_requested')
      .in('id', contactIds);
    if (error) throw new Error('טעינת אנשי הקשר נכשלה');
    contacts = data ?? [];
  }

  return aggregateDeliveryBreakdown(interactions ?? [], contacts);
}
