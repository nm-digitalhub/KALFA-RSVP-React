import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// THE pricing module (personal-coupons task 4.1): every read of a campaign's price goes through here, against
// `campaign_pricing` — the append-only pricing rounds (design.md D2). The table is CLOSED (RLS with no policy,
// service-role only), so this module runs on the admin client; CALLERS must have proven access to the campaign
// first (an RLS-scoped campaign read, or an explicit ownership check) — this module adds no authorization.
//
// One current row per campaign is a database fact (partial unique index where superseded_at is null). A campaign
// without a current row has no package and nothing to pay — the pre-package era's campaigns.
//
// CONTRACT NOTE (design.md D8 phase 3): `campaigns.package_price` is a trigger-maintained MIRROR of the current
// round and is scheduled to be dropped once the equality check returns no rows. Nothing outside this module may
// read it; new code reads the round.

export type CurrentPricing = {
  /** The current round's id — what an approval or a payment binds to (D22). */
  roundId: string;
  version: number;
  listPrice: number;
  discountAmount: number;
  /** The final price: list_price - discount_amount (a check constraint on every row). */
  price: number;
  /** Set when approval froze this round; a locked round is what a purchase may charge. */
  lockedAt: string | null;
  /** The personal benefit bound to this round, when the price carries one (D3/D10). */
  couponAssignmentId: string | null;
};

type Row = {
  id: string;
  version: number;
  list_price: number;
  discount_amount: number;
  package_price: number;
  locked_at: string | null;
  coupon_assignment_id: string | null;
};

const ROUND_COLUMNS = 'id, version, list_price, discount_amount, package_price, locked_at, coupon_assignment_id';

function toCurrentPricing(round: Row): CurrentPricing {
  return {
    roundId: round.id,
    version: round.version,
    listPrice: Number(round.list_price),
    discountAmount: Number(round.discount_amount),
    price: Number(round.package_price),
    lockedAt: round.locked_at,
    couponAssignmentId: round.coupon_assignment_id,
  };
}

/** The campaign's current pricing round, or null when it has none (no package) or the read fails. */
export async function getCurrentPricing(campaignId: string): Promise<CurrentPricing | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('campaign_pricing')
      .select(ROUND_COLUMNS)
      .eq('campaign_id', campaignId)
      .is('superseded_at', null)
      .maybeSingle();
    if (error || !data) return null;
    return toCurrentPricing(data as Row);
  } catch {
    return null;
  }
}

/**
 * Like getCurrentPricing, but a FAILED READ throws instead of answering null — the money paths (purchase, approval)
 * must tell "the campaign has no round" (refuse as not purchasable) apart from "the database could not answer"
 * (an error the buyer may retry). Screens keep the null-collapsing reader above.
 */
export async function getCurrentPricingOrThrow(campaignId: string): Promise<CurrentPricing | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaign_pricing')
    .select(ROUND_COLUMNS)
    .eq('campaign_id', campaignId)
    .is('superseded_at', null)
    .maybeSingle();
  if (error) throw new Error('round_read_failed');
  return data ? toCurrentPricing(data as Row) : null;
}

/** Current pricing for several campaigns in ONE query (list screens — no N+1). Campaigns without a round are absent. */
export async function getCurrentPricingByCampaign(campaignIds: string[]): Promise<Map<string, CurrentPricing>> {
  const out = new Map<string, CurrentPricing>();
  if (campaignIds.length === 0) return out;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('campaign_pricing')
      .select(`campaign_id, ${ROUND_COLUMNS}`)
      .in('campaign_id', campaignIds)
      .is('superseded_at', null);
    if (error || !data) return out;
    for (const row of data as Array<Row & { campaign_id: string }>) {
      out.set(row.campaign_id, toCurrentPricing(row));
    }
    return out;
  } catch {
    return out;
  }
}
