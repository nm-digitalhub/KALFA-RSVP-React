import type { LedgerMoney, PaymentState } from '@/lib/payments/status';

// The ONE payment status of a campaign in the admin campaigns list (owner 9.10.2026): a single badge, no amounts. The
// amounts, the order number and every operation with its date and outcome stay on the campaign page's payments list,
// which the badge opens. Pure: the page passes what the gated readers already fetched.
//
// Two sources, because a campaign's money lives in one of them or both:
//   - the payment ledger (payment_operations): the package purchase, every refund, and anything written there later —
//     read through deriveStatus/ledgerMoney, by each kind's EFFECT, so a new kind needs no change here;
//   - the campaign's own hold columns (capture_status, charge_status, release_status), which only a pay-per-result
//     campaign with a card hold has — its hold and final-charge paths never wrote the ledger.
// An unresolved row wins (money may be moving), then a refund, then a payment, then what became of a hold.

export type CampaignPaymentStatus =
  | 'review'
  | 'pending'
  | 'refunded_full'
  | 'refunded_partial'
  | 'paid'
  | 'failed'
  | 'hold_released'
  | 'hold_awaiting_release';

export const CAMPAIGN_PAYMENT_STATUS_LABELS: Record<
  CampaignPaymentStatus,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'neutral' }
> = {
  review: { label: 'בבדיקה', variant: 'destructive' },
  pending: { label: 'ממתין לתשלום', variant: 'warning' },
  refunded_full: { label: 'הוחזר במלואו', variant: 'neutral' },
  refunded_partial: { label: 'הוחזר חלקית', variant: 'neutral' },
  paid: { label: 'שולם', variant: 'success' },
  failed: { label: 'התשלום נכשל', variant: 'destructive' },
  hold_released: { label: 'המסגרת שוחררה', variant: 'neutral' },
  // Closed with nothing to charge and the release not seen yet: the customer's card may still be blocked, so an admin
  // must see it apart from "released".
  hold_awaiting_release: { label: 'המסגרת ממתינה לשחרור', variant: 'warning' },
};

export interface HoldColumns {
  captureStatus: string | null;
  chargeStatus: string | null;
  releaseStatus: string | null;
  finalChargeAmount: number | null;
}

const toCents = (n: number) => Math.round(n * 100);

/** null = nothing ever happened to this campaign's money (the cell shows "—"). */
export function campaignPaymentStatus(
  ledger: { state: PaymentState; money: LedgerMoney } | null,
  hold: HoldColumns,
): CampaignPaymentStatus | null {
  const state = ledger?.state.status ?? 'none';
  const money = ledger?.money;

  if (state === 'review' || hold.captureStatus === 'hold_review' || hold.chargeStatus === 'charge_review') return 'review';
  if (state === 'pending') return 'pending';

  if (money && money.refunded > 0) {
    // What was paid: the ledger's own payments, or — for a hold campaign whose charge never reached the ledger — its
    // final charge.
    const paid = money.paid > 0 ? money.paid : hold.chargeStatus === 'charged' ? Number(hold.finalChargeAmount ?? 0) : 0;
    return paid > 0 && toCents(money.refunded) < toCents(paid) ? 'refunded_partial' : 'refunded_full';
  }
  if (money && money.paid > 0) return 'paid';

  if (hold.captureStatus === 'hold_failed') return 'failed';
  if (hold.captureStatus === 'pending') return 'pending';
  if (hold.captureStatus === 'authorized') {
    // capture_status stays 'authorized' for the campaign's whole life; the charge and release columns say what became of
    // the money. A capture beats a stray release mark: charged money cannot be "released".
    if (hold.chargeStatus === 'charged') return 'paid';
    if (hold.chargeStatus === 'charge_failed') return 'failed';
    if (hold.releaseStatus === 'released') return 'hold_released';
    if (hold.chargeStatus === 'nothing_to_charge') return 'hold_awaiting_release';
    // Held, or the final charge in flight: nothing has been paid yet.
    return 'pending';
  }
  // A hold state this code does not know: a person should look, never a guessed "paid" or "nothing".
  if (hold.captureStatus) return 'review';

  if (state === 'declined') return 'failed';
  if (state === 'released') return 'hold_released';
  if (state === 'committed') return 'pending';
  return null;
}
