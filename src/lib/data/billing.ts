import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { setContactOpStatus } from '@/lib/data/interactions';
import type { Database } from '@/lib/supabase/types';

type Channel = Database['public']['Enums']['campaign_channel'];

// All billing writes go through the try_record_billed_result RPC — the cap +
// window + one-per-(event,contact) dedup live in that locked txn, never in JS.
// The RPCs are created by a pending migration → not in the generated types yet,
// so we call them via an un-generic client cast (only reached behind the gated,
// signature-verified webhook).

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
// 'no_campaign'. On 'billed' the contact is moved to reached_billed.
export async function recordReached(args: ReachedArgs): Promise<string> {
  const admin = createAdminClient() as unknown as SupabaseClient;
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
  const admin = createAdminClient() as unknown as SupabaseClient;
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

// Σ of approved credits scoped to THIS campaign (§14/§16/D5). Gross (VAT-inclusive),
// to match the price basis. Event-level credits (null campaign_id) are NOT applied
// here — they belong to the event account / next campaign. THROWS on a real error
// (routes close-charge to review, like the summary), never silently 0.
export async function getCampaignCreditTotal(campaignId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('billing_credits')
    .select('amount')
    .eq('campaign_id', campaignId);
  if (error) throw new Error('שליפת הזיכויים נכשלה');
  return (data ?? []).reduce(
    (sum, r) => sum + Number((r as { amount: number | string }).amount ?? 0),
    0,
  );
}
