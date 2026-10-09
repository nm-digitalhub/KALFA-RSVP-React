import { CAMPAIGN_PAYMENT_STATUS_LABELS, type CampaignPaymentStatus } from './campaign-payment-status';

// The money column of the cancellation-requests list: the campaign's one payment status (the same vocabulary as the
// campaigns list, campaign-payment-status.ts), with two facts only a request has. Pure.
//   - a PENDING request whose latest refund attempt failed: that, before anything else — it is why staff open it;
//   - a live campaign with nothing ever paid: "לא שולם" (the campaigns list shows "—" there; here it answers "is there
//     money to give back?").
// No live campaign at all → null: the cell shows "—".
export type CancellationListMoney = CampaignPaymentStatus | 'refund_failed' | 'unpaid';

export const CANCELLATION_LIST_MONEY_LABELS: Record<
  CancellationListMoney,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'neutral' }
> = {
  ...CAMPAIGN_PAYMENT_STATUS_LABELS,
  refund_failed: { label: 'ניסיון החזר נכשל', variant: 'destructive' },
  unpaid: { label: 'לא שולם', variant: 'neutral' },
};

export function cancellationListMoney(input: {
  pending: boolean;
  hasCampaign: boolean;
  lastRefundOutcome: string | null;
  campaignStatus: CampaignPaymentStatus | null;
}): CancellationListMoney | null {
  if (input.pending && input.lastRefundOutcome === 'failed') return 'refund_failed';
  if (input.campaignStatus) return input.campaignStatus;
  return input.hasCampaign ? 'unpaid' : null;
}
