import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

import { upTo, type CoreWindow } from './window';

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
// and in particular no card field, document URL or credit `reason` text is
// ever selected.
//
// The counts read the payment ledger (payment_operations), the one record of
// money: real money only (is_test = false, as the sums below), and by each
// kind's EFFECT (payment_operation_kinds) so a new kind needs no change here.
//
// The money SUMS come from ONE rpc. Charged amount, credit applied and credit
// granted are sums, and PostgREST aggregates are disabled on this project
// (measured 2026-09-24: authenticator carries no pgrst.db_aggregates_enabled),
// so they cannot be computed through the Data API without loading rows. They
// come from public.owner_agent_billing_sums(_since, _until), created in
// supabase/migrations/20260924061630_owner_agent_read_aggregates.sql and
// recreated with the optional _until in
// 20260927011338_owner_agent_capabilities.sql, and reading the payment ledger
// only since 20261011190351_db_functions_stop_reading_retired_columns.sql.
// Amounts are shekels (tax-ceiling.ts compares the same charged_amount against
// OSEK_PATUR_YEARLY_CEILING_ILS), and are not integers.
//
// Errors THROW: a failed count or sum must not reach the owner as a confident 0.

type AdminClient = ReturnType<typeof createAdminClient>;

// Ledger rows of real money, joined to their kind so a filter can name the EFFECT.
function operations(client: AdminClient) {
  return client
    .from('payment_operations')
    .select('id, payment_operation_kinds!inner(effect)', { count: 'exact', head: true })
    .eq('is_test', false);
}

function credits(client: AdminClient) {
  return client.from('billing_credits').select('id', { count: 'exact', head: true });
}

function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}

// A table-returning rpc answers with an array; the sums function always yields
// exactly one row (four coalesced sums). Anything else — no row, two rows, a
// value that is not a finite non-negative number — is thrown as a bare code
// rather than reported as a sum.
function amount(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}

// `_until` is passed only for a window: the default call keeps its exact
// one-argument shape (the function's _until defaults to null = open-ended).
async function billingSums(client: AdminClient, sinceIso: string, window: CoreWindow | undefined) {
  const { data, error } = await client.rpc(
    'owner_agent_billing_sums',
    window ? { _since: sinceIso, _until: window.untilIso } : { _since: sinceIso },
  );
  if (error) throw new Error('billing_sums_failed');
  if (!Array.isArray(data) || data.length !== 1) throw new Error('billing_sums_unexpected');
  const [row] = data;
  return {
    chargedAmountIls: amount(row.charged_amount, 'billing_sums_unexpected'),
    creditAppliedAmountIls: amount(row.credit_applied_amount, 'billing_sums_unexpected'),
    creditUnvoidedAmountIls: amount(row.unvoided_credit_amount, 'billing_sums_unexpected'),
    creditGrantedAmountIls: amount(row.credit_granted_amount, 'billing_sums_unexpected'),
  };
}

export interface BillingSummary {
  // Ledger operations dated by occurred_at within the range: money collected (a package purchase or upgrade), money
  // returned (a refund), and a collection that was declined.
  paymentsInRange: number;
  refundsInRange: number;
  paymentsFailedInRange: number;
  // Current state (not range-bound): operations whose outcome is not known yet, and operations a person must resolve.
  operationsPending: number;
  operationsInReview: number;
  // Credits (billing_credits) — current and within the range.
  creditsActive: number; // not voided
  creditsGrantedInRange: number; // granted in range and not voided
  creditsVoidedInRange: number;
  // Sums in shekels (owner_agent_billing_sums). In range: money collected, net of
  // returns, by the date of each operation (tax-ceiling.ts's turnover) — the
  // credit consumed by those payments,
  // and credit granted and not voided. Current: all credit granted and not voided.
  chargedAmountIls: number;
  creditAppliedAmountIls: number;
  creditGrantedAmountIls: number;
  creditUnvoidedAmountIls: number;
}

export async function getBillingSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
  window?: CoreWindow,
): Promise<BillingSummary> {
  // `window` (cores/window.ts) bounds the *InRange counts and the in-range
  // sums; the current-state counts and creditUnvoidedAmountIls ignore it.
  const sinceIso = window?.sinceIso ?? rangeStartIso(range, nowMs);
  const [
    paymentsInRange,
    refundsInRange,
    paymentsFailedInRange,
    operationsPending,
    operationsInReview,
    creditsActive,
    creditsGrantedInRange,
    creditsVoidedInRange,
    sums,
  ] = await Promise.all([
    upTo(
      operations(client)
        .eq('payment_operation_kinds.effect', 'collect')
        .eq('outcome', 'succeeded')
        .gte('occurred_at', sinceIso),
      'occurred_at',
      window,
    ),
    upTo(
      operations(client)
        .eq('payment_operation_kinds.effect', 'return')
        .eq('outcome', 'succeeded')
        .gte('occurred_at', sinceIso),
      'occurred_at',
      window,
    ),
    upTo(
      operations(client)
        .eq('payment_operation_kinds.effect', 'collect')
        .eq('outcome', 'failed')
        .gte('occurred_at', sinceIso),
      'occurred_at',
      window,
    ),
    operations(client).eq('outcome', 'pending'),
    operations(client).eq('outcome', 'review'),
    credits(client).is('voided_at', null),
    upTo(credits(client).is('voided_at', null).gte('created_at', sinceIso), 'created_at', window),
    upTo(credits(client).gte('voided_at', sinceIso), 'voided_at', window),
    billingSums(client, sinceIso, window),
  ]);
  return {
    paymentsInRange: countOf(paymentsInRange, 'count_payments_failed'),
    refundsInRange: countOf(refundsInRange, 'count_refunds_failed'),
    paymentsFailedInRange: countOf(paymentsFailedInRange, 'count_payments_declined_failed'),
    operationsPending: countOf(operationsPending, 'count_pending_failed'),
    operationsInReview: countOf(operationsInReview, 'count_review_failed'),
    creditsActive: countOf(creditsActive, 'count_credits_active_failed'),
    creditsGrantedInRange: countOf(creditsGrantedInRange, 'count_credits_granted_failed'),
    creditsVoidedInRange: countOf(creditsVoidedInRange, 'count_credits_voided_failed'),
    chargedAmountIls: sums.chargedAmountIls,
    creditAppliedAmountIls: sums.creditAppliedAmountIls,
    creditGrantedAmountIls: sums.creditGrantedAmountIls,
    creditUnvoidedAmountIls: sums.creditUnvoidedAmountIls,
  };
}
