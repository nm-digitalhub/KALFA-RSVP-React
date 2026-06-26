import 'server-only';

import {
  getPaymentsEnabled,
  getCloseChargeEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import { VAT_RATE_PERCENT } from '@/lib/agreements/template';
import {
  closeCampaign,
  getCampaignForCharge,
  lockCampaignForCharge,
  recordCampaignCharge,
  markCampaignChargeOutcome,
} from '@/lib/data/campaigns';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { captureHeldCardSumit } from '@/lib/sumit/capture';
import { SumitDeclinedError } from '@/lib/sumit/charge';

export type CloseChargeOutcome = {
  outcome:
    | 'charged'
    | 'nothing_to_charge'
    | 'declined'
    | 'review'
    | 'disabled'
    | 'bad_state';
  amount: number;
};

const CLOSEABLE = ['active', 'paused', 'approved', 'scheduled'];

// Close a campaign and charge the held card for the accrued reached-contact total.
// Fail-closed; server-derives amount = min(Σ locked_price, ceiling); charges at
// most once (atomic guard); retry-tolerant (an already-closed campaign in a
// retryable charge state proceeds to charge). Ownership is enforced by the caller.
export async function closeCampaignAndCharge(
  campaignId: string,
): Promise<CloseChargeOutcome> {
  const [paymentsOn, closeOn, sumit] = await Promise.all([
    getPaymentsEnabled(),
    getCloseChargeEnabled(),
    getSumitServerConfig(),
  ]);
  if (!paymentsOn || !closeOn || !sumit) {
    return { outcome: 'disabled', amount: 0 };
  }

  const campaign = await getCampaignForCharge(campaignId);
  if (!campaign) return { outcome: 'bad_state', amount: 0 };

  // Close if still open; tolerate an already-closed campaign (retry); reject any
  // non-closeable, non-closed state (e.g. draft/pending_approval).
  if (CLOSEABLE.includes(campaign.status)) {
    await closeCampaign(campaignId);
  } else if (campaign.status !== 'closed') {
    return { outcome: 'bad_state', amount: 0 };
  }

  // A charge needs a held card saved against a recoverable Customer.
  if (campaign.capture_status !== 'authorized' || !campaign.sumit_customer_ref) {
    return { outcome: 'bad_state', amount: 0 };
  }

  const summary = await getCampaignBillingSummary(campaignId);
  const accrued = summary?.accrued ?? 0;
  const ceiling = campaign.max_charge_ceiling
    ? parseFloat(campaign.max_charge_ceiling)
    : (summary?.ceiling ?? 0);
  const amount = Math.min(accrued, ceiling);

  if (amount <= 0) {
    await markCampaignChargeOutcome(campaignId, 'nothing_to_charge');
    return { outcome: 'nothing_to_charge', amount: 0 };
  }

  // Idempotency: only the caller that wins the atomic guard charges.
  const locked = await lockCampaignForCharge(campaignId);
  if (!locked) return { outcome: 'bad_state', amount };

  try {
    const { documentId } = await captureHeldCardSumit({
      companyId: sumit.companyId,
      apiKey: sumit.apiKey,
      customerRef: campaign.sumit_customer_ref,
      amount: amount.toString(),
      vatRate: String(VAT_RATE_PERCENT),
      customerEmail: '',
    });
    await recordCampaignCharge(campaignId, { amount, documentId });
    return { outcome: 'charged', amount };
  } catch (e) {
    if (e instanceof SumitDeclinedError) {
      await markCampaignChargeOutcome(campaignId, 'charge_failed');
      return { outcome: 'declined', amount };
    }
    // Network / ambiguous → review, never silently retried (may have charged).
    await markCampaignChargeOutcome(campaignId, 'charge_review');
    return { outcome: 'review', amount };
  }
}
