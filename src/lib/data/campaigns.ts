import 'server-only';

import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { countUniqueContactsForEvent } from '@/lib/data/contacts';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import type { CampaignTermsInput } from '@/lib/validation/campaigns';

// Campaign = "campaign approval for an event" (outcome-billing). Owner sets the
// commercial terms; the charge ceiling is computed server-side. Reads are
// owner-scoped via RLS (owns_event); writes go through the service-role admin
// client after an explicit ownership check (no client-side billing writes, §18).

type CampaignRow = Database['public']['Tables']['campaigns']['Row'];
type Channel = Database['public']['Enums']['campaign_channel'];

export type OwnerCampaign = Pick<
  CampaignRow,
  | 'id'
  | 'event_id'
  | 'status'
  | 'price_per_reached'
  | 'max_contacts'
  | 'max_charge_ceiling'
  | 'allowed_channels'
  | 'start_at'
  | 'close_at'
  | 'approved_at'
  | 'final_charge_amount'
  | 'capture_status'
  | 'created_at'
>;

const CAMPAIGN_COLUMNS =
  'id, event_id, status, price_per_reached, max_contacts, max_charge_ceiling, allowed_channels, start_at, close_at, approved_at, final_charge_amount, capture_status, created_at';

// Pure: the approved charge ceiling = price-per-reached × max contacts, rounded
// to agorot. The ceiling is the maximum the system may ever bill (§7); it is
// derived server-side and never accepted from the client.
export function computeCeiling(pricePerReached: number, maxContacts: number): number {
  return Math.round(pricePerReached * maxContacts * 100) / 100;
}

// A single touchpoint in the event-anchored outreach schedule (§10) — a friendly
// drip leading up to the event to maximize reached contacts.
export type OutreachTouchpoint = {
  days_before: number; // days before the event date
  channel: Channel;
  message_key: string; // references an approved WhatsApp template / call script
};

// Commercial templates (§17) — active packages that carry a recommended
// price-per-reached, the channels, and the outreach schedule. KALFA (admin)
// defines these; the owner chooses one (or, with one, just sees it).
export type CampaignTemplate = {
  id: string;
  name: string;
  price_per_reached: number;
  description: string | null;
  channels: Channel[];
  outreach_schedule: OutreachTouchpoint[];
};

export async function listCampaignTemplates(): Promise<CampaignTemplate[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('packages')
    .select('id, name, price_per_reached, description, channels, outreach_schedule')
    .eq('active', true)
    .not('price_per_reached', 'is', null)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת מסלולי השירות נכשלה');
  return (data ?? [])
    .filter((p): p is typeof p & { price_per_reached: number } =>
      p.price_per_reached != null,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      price_per_reached: Number(p.price_per_reached),
      description: p.description,
      channels: p.channels ?? [],
      outreach_schedule:
        (p.outreach_schedule as OutreachTouchpoint[] | null) ?? [],
    }));
}

// Create a campaign in `pending_approval`. The price-per-reached is read from
// the selected template SERVER-SIDE and copied+locked onto the campaign (§17,
// §354) — the client only chooses the template, never the price (§18.7/§18.8).
export async function createCampaign(
  eventId: string,
  terms: CampaignTermsInput,
): Promise<{ id: string }> {
  await requireOwnedEvent(eventId);

  // max_contacts is DERIVED from the unique-contact count, not owner input (§7).
  const maxContacts = await countUniqueContactsForEvent(eventId);
  if (maxContacts < 1) {
    throw new Error('אין אנשי קשר תקינים ברשימת המוזמנים — הוסיפו מוזמנים עם מספר טלפון תקין');
  }

  const admin = createAdminClient();

  // Authoritative price from the template (reject unknown/inactive/priceless).
  const { data: template, error: tplErr } = await admin
    .from('packages')
    .select('id, price_per_reached, active, channels, outreach_schedule')
    .eq('id', terms.template_id)
    .maybeSingle();
  if (tplErr) throw new Error('טעינת מסלול השירות נכשלה');
  if (!template || !template.active || template.price_per_reached == null) {
    throw new Error('מסלול השירות שנבחר אינו תקין');
  }
  const price = Number(template.price_per_reached);

  // The campaign uses the template's channels (§1/§17) — both channels are part
  // of the service; the owner does not choose channels.
  const templateChannels = template.channels ?? [];
  if (templateChannels.length === 0) {
    throw new Error('למסלול השירות לא הוגדרו ערוצי פנייה');
  }

  const { data, error } = await admin
    .from('campaigns')
    .insert({
      event_id: eventId,
      status: 'pending_approval',
      template_id: template.id,
      price_per_reached: price, // locked copy from the template
      max_contacts: maxContacts, // derived from the unique-contact count (§7)
      max_charge_ceiling: computeCeiling(price, maxContacts),
      allowed_channels: templateChannels, // from the template, not owner choice
      start_at: terms.start_at ?? null,
      close_at: terms.close_at ?? null,
      // Outreach schedule copied + locked from the template (§10/§17).
      outreach_schedule: template.outreach_schedule,
      // steps ('[]') and enabled (false) use their column defaults.
    })
    .select('id')
    .single();

  if (error || !data) throw new Error('יצירת הקמפיין נכשלה');
  return { id: data.id };
}

export async function getCampaign(campaignId: string): Promise<OwnerCampaign> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!data) {
    const { notFound } = await import('next/navigation');
    notFound();
  }
  return data as OwnerCampaign;
}

export async function listCampaignsForEvent(
  eventId: string,
): Promise<OwnerCampaign[]> {
  await requireOwnedEvent(eventId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('טעינת הקמפיינים נכשלה');
  return (data ?? []) as OwnerCampaign[];
}

// Transition a campaign pending_approval → approved. Guarded so a campaign can
// only be approved once (§18.7 — terms lock on approval; no re-approval). The
// signed agreement must already be recorded by the caller before this runs.
// Ownership is verified; the write goes through the service-role admin client
// with an optimistic status guard to be race-safe.
export async function approveCampaign(
  campaignId: string,
  tosVersion: string,
): Promise<void> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, event_id, status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }

  await requireOwnedEvent(campaign.event_id); // ownership

  if (campaign.status !== 'pending_approval') {
    throw new Error('ניתן לאשר רק קמפיין הממתין לאישור');
  }

  const { error: upErr } = await admin
    .from('campaigns')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      tos_version: tosVersion,
    })
    .eq('id', campaignId)
    .eq('status', 'pending_approval'); // race-safe optimistic guard
  if (upErr) throw new Error('אישור הקמפיין נכשל');
}

// --- Route A: J5 authorization hold (card capture at approval) ---------------
// capture_status is a free-text column; the working vocabulary is:
//   null         no hold yet
//   pending      a hold attempt is in flight (the atomic lock below)
//   authorized   a hold succeeded (auth_number/card_token_ref stored)
//   hold_failed  a definitive decline — retryable
//   hold_review  an ambiguous provider outcome — retryable / needs reconciliation

export type CampaignHoldState = Pick<
  CampaignRow,
  'id' | 'event_id' | 'status' | 'max_charge_ceiling' | 'capture_status'
>;

// Read the hold-relevant fields. Service-role (the hold writes bypass RLS); the
// caller (the Route Handler) has already verified ownership.
export async function getCampaignForHold(
  campaignId: string,
): Promise<CampaignHoldState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id, status, max_charge_ceiling, capture_status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  return data;
}

// Atomically claim the hold slot. The guarded UPDATE only matches when there is
// no hold yet (null) or a prior attempt is retryable (hold_failed/hold_review),
// so two concurrent submits can never both place a hold (§13 anti-double-charge
// in spirit). Returns true only for the caller that won the slot.
export async function lockCampaignForHold(campaignId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .update({ capture_status: 'pending' })
    .eq('id', campaignId)
    .or('capture_status.is.null,capture_status.in.(hold_failed,hold_review)')
    .select('id')
    .maybeSingle();
  if (error) throw new Error('נעילת הקמפיין לחיוב נכשלה');
  return data !== null;
}

// Persist a successful hold. auth_amount is the server-derived ceiling (numeric),
// never client input. Card token + auth number are evidence for the later capture.
export async function recordCampaignHold(
  campaignId: string,
  hold: { authNumber: string; authAmount: number; cardToken: string | null },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('campaigns')
    .update({
      capture_status: 'authorized',
      auth_number: hold.authNumber,
      auth_amount: hold.authAmount,
      card_token_ref: hold.cardToken,
      authorized_at: new Date().toISOString(),
    })
    .eq('id', campaignId);
  if (error) throw new Error('שמירת תפיסת המסגרת נכשלה');
}

// Release the lock to a retryable state after a failed/ambiguous hold. Never
// touches status — the agreement stays signed and the campaign stays approved.
export async function markCampaignHoldFailed(
  campaignId: string,
  status: 'hold_failed' | 'hold_review',
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('campaigns')
    .update({ capture_status: status })
    .eq('id', campaignId);
  if (error) throw new Error('עדכון מצב התפיסה נכשל');
}
