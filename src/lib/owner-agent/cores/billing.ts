import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for billing counts (owner-agent tool 3, billing_summary;
// plan §5). Takes a service-role client and returns numbers only.
// Authorization is the caller's: view_billing, resolved server-side for the
// staff member before the tool is offered (plan §3.2). There is no /admin
// wrapper to share it with today: no admin screen aggregates billing across
// campaigns (getCampaignBillingSummary in billing.ts is per campaign and must
// NOT be looped here — that is the N+1 the plan rules out).
//
// No imports of the DAL or of request-scoped Next APIs (enforced by the
// `owner-agent-request-free` rule in .dependency-cruiser.cjs).
//
// Privacy: head-only counts (`head: true`), so no row leaves the database —
// and in particular no card_token_ref, card_citizen_id, card_exp_*,
// auth_external_ref, document URL or credit `reason` text is ever selected.
//
// PENDING MIGRATION — the money SUMS. Charged amount, credit applied and credit
// granted are sums, and PostgREST aggregates are disabled on this project
// (measured 2026-09-24: authenticator carries no pgrst.db_aggregates_enabled),
// so they cannot be computed through the Data API without loading rows. They
// live in public.owner_agent_billing_sums(_since), in
// supabase/migrations/20260924061630_owner_agent_read_aggregates.sql, which is
// NOT applied. Once it is applied and types.generated.ts is regenerated, this
// core adds one `.rpc('owner_agent_billing_sums', { _since })` call and four
// number fields. Until then it returns the counts below and nothing that
// pretends to be a sum.
//
// Errors THROW: a failed count must not reach the owner as a confident 0.
//
// Stuck holds (approved with a pending/failed/review hold) are tool 2's
// number (cores/campaigns.ts stuckHolds, manage_billing) and are not repeated
// here.

type AdminClient = ReturnType<typeof createAdminClient>;

function campaigns(client: AdminClient) {
  return client.from('campaigns').select('id', { count: 'exact', head: true });
}

function credits(client: AdminClient) {
  return client.from('billing_credits').select('id', { count: 'exact', head: true });
}

function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}

export interface BillingSummary {
  // Close-charge outcomes dated by charged_at within the range. 'charged' is
  // the turnover definition of tax-ceiling.ts; 'nothing_to_charge' is a closed
  // campaign whose accrued total was fully covered (credit, or nothing reached).
  chargedInRange: number;
  nothingToChargeInRange: number;
  // Current state of the final charge (not range-bound): a claim in flight
  // (or stuck mid-flight), a declined charge, a charge that needs a human.
  chargesPending: number;
  chargesFailed: number;
  chargesInReview: number;
  // Current: card hold authorized, no final-charge outcome yet, not released.
  holdsAwaitingCharge: number;
  // Credits (billing_credits) — current and within the range.
  creditsActive: number; // not voided
  creditsGrantedInRange: number; // granted in range and not voided
  creditsVoidedInRange: number;
}

export async function getBillingSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<BillingSummary> {
  const sinceIso = rangeStartIso(range, nowMs);
  const [
    chargedInRange,
    nothingToChargeInRange,
    chargesPending,
    chargesFailed,
    chargesInReview,
    holdsAwaitingCharge,
    creditsActive,
    creditsGrantedInRange,
    creditsVoidedInRange,
  ] = await Promise.all([
    campaigns(client).eq('charge_status', 'charged').gte('charged_at', sinceIso),
    campaigns(client).eq('charge_status', 'nothing_to_charge').gte('charged_at', sinceIso),
    campaigns(client).eq('charge_status', 'pending'),
    campaigns(client).eq('charge_status', 'charge_failed'),
    campaigns(client).eq('charge_status', 'charge_review'),
    campaigns(client)
      .eq('capture_status', 'authorized')
      .is('charge_status', null)
      .is('release_status', null),
    credits(client).is('voided_at', null),
    credits(client).is('voided_at', null).gte('created_at', sinceIso),
    credits(client).gte('voided_at', sinceIso),
  ]);
  return {
    chargedInRange: countOf(chargedInRange, 'count_charged_failed'),
    nothingToChargeInRange: countOf(nothingToChargeInRange, 'count_nothing_to_charge_failed'),
    chargesPending: countOf(chargesPending, 'count_charge_pending_failed'),
    chargesFailed: countOf(chargesFailed, 'count_charge_failed_failed'),
    chargesInReview: countOf(chargesInReview, 'count_charge_review_failed'),
    holdsAwaitingCharge: countOf(holdsAwaitingCharge, 'count_holds_failed'),
    creditsActive: countOf(creditsActive, 'count_credits_active_failed'),
    creditsGrantedInRange: countOf(creditsGrantedInRange, 'count_credits_granted_failed'),
    creditsVoidedInRange: countOf(creditsVoidedInRange, 'count_credits_voided_failed'),
  };
}
