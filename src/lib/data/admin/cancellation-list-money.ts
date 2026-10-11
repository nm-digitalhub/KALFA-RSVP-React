import { CAMPAIGN_PAYMENT_STATUS_LABELS, type CampaignPaymentStatus } from './campaign-payment-status';

// The money column of the cancellation-requests list. A PENDING request shows the campaign's one payment status (the
// same vocabulary as the campaigns list, campaign-payment-status.ts), since that is the money still to decide about; a
// RESOLVED request shows its own outcome, because two requests of one event share one campaign (9.10.2026: a declined
// duplicate of a refunded request read "הוחזר במלואו"). Pure.
//   - a pending request whose latest refund attempt failed: that, before anything else — it is why staff open it;
//   - a declined request: "נדחתה", whatever the campaign's money did through another request;
//   - a resolved request with a refund of its own that succeeded: refunded in full, or in part for a partial charge;
//   - a resolved request with no refund of its own (nothing was paid, or a hold was released): the campaign's status;
//   - a live campaign with nothing ever paid: "לא שולם" (the campaigns list shows "—" there; here it answers "is there
//     money to give back?").
// No live campaign at all → null: the cell shows "—".
export type CancellationListMoney = CampaignPaymentStatus | 'refund_failed' | 'unpaid' | 'declined';

export const CANCELLATION_LIST_MONEY_LABELS: Record<
  CancellationListMoney,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'neutral' }
> = {
  ...CAMPAIGN_PAYMENT_STATUS_LABELS,
  refund_failed: { label: 'ניסיון החזר נכשל', variant: 'destructive' },
  unpaid: { label: 'לא שולם', variant: 'neutral' },
  declined: { label: 'נדחתה', variant: 'neutral' },
};

export function cancellationListMoney(input: {
  pending: boolean;
  resolution: 'full_cancellation' | 'partial_charge' | 'declined' | null;
  hasCampaign: boolean;
  lastRefundOutcome: string | null;
  // A refund recorded for THIS request (payment_operations.meta.cancellation_request_id) succeeded.
  refundSucceeded: boolean;
  campaignStatus: CampaignPaymentStatus | null;
}): CancellationListMoney | null {
  if (input.pending && input.lastRefundOutcome === 'failed') return 'refund_failed';
  if (!input.pending) {
    if (input.resolution === 'declined') return 'declined';
    if (input.refundSucceeded) return input.resolution === 'partial_charge' ? 'refunded_partial' : 'refunded_full';
  }
  if (input.campaignStatus) return input.campaignStatus;
  return input.hasCampaign ? 'unpaid' : null;
}
