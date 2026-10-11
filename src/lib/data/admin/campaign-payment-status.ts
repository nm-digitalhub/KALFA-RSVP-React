import type { LedgerMoney, PaymentState } from '@/lib/payments/status';

// The ONE payment status of a campaign in the admin campaigns list (owner 9.10.2026): a single badge, no amounts. The
// amounts, the order number and every operation with its date and outcome stay on the campaign page's payments list,
// which the badge opens. Pure: the page passes what the gated readers already fetched.
//
// One source: the payment ledger (payment_operations) — the package purchase, every refund, and the card holds of the
// retired pay-per-result campaigns (their authorize, release and charge rows) — read through deriveStatus/ledgerMoney,
// by each kind's EFFECT, so a new kind needs no change here. An unresolved row wins (money may be moving), then a refund,
// then a payment, then what became of a hold.

export type CampaignPaymentStatus =
  | 'review'
  | 'pending'
  | 'refunded_full'
  | 'refunded_partial'
  | 'paid'
  | 'failed'
  // History: a pay-per-result campaign's card hold that ended with nothing paid. No new campaign holds a card.
  | 'hold_released';

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
};

/** What the admin readers fold from a campaign's ledger rows (ledgerForAdmin). */
export interface CampaignLedger {
  state: PaymentState;
  money: LedgerMoney;
  /** A card guarantee was released (a succeeded `void` row) — the end of a retired pay-per-result hold. */
  released: boolean;
}

const toCents = (n: number) => Math.round(n * 100);

/** null = nothing ever happened to this campaign's money (the cell shows "—"). */
export function campaignPaymentStatus(ledger: CampaignLedger | null): CampaignPaymentStatus | null {
  if (!ledger) return null;
  const { state, money, released } = ledger;

  if (state.status === 'review') return 'review';
  if (state.status === 'pending') return 'pending';

  if (money.refunded > 0) {
    return money.paid > 0 && toCents(money.refunded) < toCents(money.paid) ? 'refunded_partial' : 'refunded_full';
  }
  if (money.paid > 0) return 'paid';

  if (state.status === 'declined') return 'failed';
  // Nothing paid and the guarantee released: a pay-per-result hold that settled at ₪0 (its ₪0 charge row makes the
  // derived state "collected", so the release row is what tells it apart).
  if (released || state.status === 'released') return 'hold_released';
  if (state.status === 'committed') return 'pending';
  return null;
}
