import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { setContactOpStatus } from '@/lib/data/interactions';
import type { Database } from '@/lib/supabase/types';

type Channel = Database['public']['Enums']['campaign_channel'];

// All billing writes go through the try_record_billed_result RPC — the cap +
// window + one-per-(event,contact) dedup live in that locked txn, never in JS.
// (Only ever reached behind the gated, signature-verified webhook.)

export type ReachedArgs = {
  eventId: string;
  campaignId: string;
  contactId: string;
  channel: Channel;
  attemptId: string;
  evidence: string;
  providerRef: string;
};

// Returns the RPC outcome: 'billed' | 'already_billed' | 'ceiling_reached' |
// 'not_active' | 'closed_window' | 'before_window' | 'removal_requested' |
// 'not_authorized' | 'no_campaign' | 'event_passed' | 'event_mismatch' |
// 'event_not_active' | 'no_exposure'. On 'billed' the contact is moved to
// reached_billed; every other outcome means NOT billed (the caller only acts on
// 'billed'). 'not_authorized' = contact not in the frozen authorized SET (the
// legacy binding cap; fail-closed — an empty set bills nobody). 'no_exposure' =
// the P0-1 exposure gate rejected the contact; it is returned ONLY when
// app_settings.billing_exposure_gate=true (default false → legacy 'not_authorized'
// path), so it is inert until that DB toggle is flipped.
export async function recordReached(args: ReachedArgs): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('try_record_billed_result', {
    p_event: args.eventId,
    p_campaign: args.campaignId,
    p_contact: args.contactId,
    p_channel: args.channel,
    p_attempt: args.attemptId,
    p_evidence: args.evidence,
    p_provider_ref: args.providerRef,
  });
  if (error) throw new Error('רישום החיוב נכשל');
  const outcome = typeof data === 'string' ? data : 'unknown';
  if (outcome === 'billed') {
    await setContactOpStatus(args.contactId, 'reached_billed');
  }
  return outcome;
}

export type BillingSummary = {
  reachedCount: number;
  accrued: number;
  ceiling: number;
  maxContacts: number;
};

// What B4 close-charge consumes: how many reached (billable) and the accrued sum
// (Σ locked_price), against the ceiling.
//
// THROWS on a real RPC error (transient DB/RPC failure) so close-charge can route
// to `review` — NEVER swallow it to a 0 that would permanently settle the campaign
// at ₪0 (the zero-bill bug). An EMPTY result (no row) is benign: it only happens
// for a nonexistent campaign, which close-charge already pre-validates via
// getCampaignForCharge → return null (treated as nothing reached, not an error).
export async function getCampaignBillingSummary(
  campaignId: string,
): Promise<BillingSummary | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('campaign_billing_summary', {
    p_campaign: campaignId,
  });
  if (error) throw new Error('שליפת סיכום החיוב נכשלה');
  if (!data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    reachedCount: Number(row.reached_count ?? 0),
    accrued: Number(row.accrued ?? 0),
    ceiling: Number(row.ceiling ?? 0),
    maxContacts: Number(row.max_contacts ?? 0),
  };
}

// Credit available to THIS campaign's close-charge (§14/§16/D5, gross to match
// the price basis) = this campaign's own credits + the event's unscoped credits
// (campaign_id null) − whatever OTHER campaigns of the same event already
// consumed (campaigns.credit_applied). Under one-campaign-per-event the sibling
// term is empty and this is simply the full pool; the sibling subtraction only
// matters for the rare cancel-and-recreate case. THROWS on a real error (routes
// close-charge to review, like the summary), never silently 0.
export async function getCampaignCreditTotal(
  campaignId: string,
  eventId: string,
): Promise<number> {
  const admin = createAdminClient();
  const [ownRes, eventRes, siblingsRes] = await Promise.all([
    admin.from('billing_credits').select('amount').eq('campaign_id', campaignId),
    admin
      .from('billing_credits')
      .select('amount')
      .is('campaign_id', null)
      .eq('event_id', eventId),
    admin
      .from('campaigns')
      .select('credit_applied')
      .eq('event_id', eventId)
      .neq('id', campaignId),
  ]);
  if (ownRes.error || eventRes.error || siblingsRes.error) {
    throw new Error('שליפת הזיכויים נכשלה');
  }
  const sumAmount = (rows: { amount: number | string }[] | null) =>
    (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const granted = sumAmount(ownRes.data) + sumAmount(eventRes.data);
  const consumedBySiblings = (siblingsRes.data ?? []).reduce(
    (s, r) => s + Number(r.credit_applied ?? 0),
    0,
  );
  return Math.max(0, granted - consumedBySiblings);
}
