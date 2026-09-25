// Pure close-charge amount for the flat-base + included + overage pricing model
// (plan S2). Kept dependency-free so it is unit-testable in isolation from the
// SUMIT/DB machinery in close-charge.ts.
//
//   charge = base + max(0, reached − included) × overage,
//            minus credits, floored at 0, rounded to agorot —
//            and, ONLY for an agreement that states a frozen ceiling (v4 and
//            earlier), capped at that number. `ceiling: null` = no cap.
//
// `overage` is the per-reached rate (campaign.price_per_reached). base/included
// come from the campaign SNAPSHOT (populated at authorize by S3). For a
// pre-model / pre-S3 campaign both are 0 (the S1 backfill / a NULL coalesced to
// 0 upstream), which reduces the formula to pure per-reached
// (reached × price_per_reached) — VERIFIED behaviour-neutral against the live
// campaigns 2026-07-26 (reached × rate == Σ locked_price for every campaign).
//
// Ceiling note: since the funded recipient cap was retired (2026-09-25) `reached`
// can exceed what the hold covered, so a numeric ceiling DOES bind. It is kept
// only because a v4 (and earlier) signed PDF states a frozen number the customer
// relied on; an open-ceiling agreement (v5+) states a formula and passes null.

export interface ChargeAmountInput {
  base: number; // campaign.base_price (₪); NULL⇒0 upstream
  included: number; // campaign.included_reached; NULL⇒0 upstream
  overage: number; // campaign.price_per_reached — per-reached rate above `included`
  reached: number; // billed_results count for the campaign
  ceiling: number | null; // frozen cap from a v4-and-earlier signed PDF; null = open ceiling (v5+), no cap
  credits: number; // credits to apply
}

export interface ChargeAmountResult {
  amount: number; // what to charge (≥ 0)
  creditApplied: number; // credit actually consumed (never more than the capped total)
}

function agorot(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeChargeAmount(input: ChargeAmountInput): ChargeAmountResult {
  const gross = input.base + Math.max(0, input.reached - input.included) * input.overage;
  const capped = input.ceiling === null ? gross : Math.min(gross, input.ceiling);
  const amount = Math.max(0, agorot(capped - input.credits));
  // The credit slice actually consumed: never more than the capped total (a
  // ₪160 credit against ₪84 capped consumes 84; the ₪76 remainder stays
  // available at the event level).
  const creditApplied = Math.max(0, agorot(capped - amount));
  return { amount, creditApplied };
}
