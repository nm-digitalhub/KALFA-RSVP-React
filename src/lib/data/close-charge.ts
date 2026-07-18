import 'server-only';

import {
  getPaymentsEnabled,
  getCloseChargeEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import {
  closeCampaign,
  getCampaignForCharge,
  lockCampaignForCharge,
  recordCampaignCharge,
  markCampaignChargeOutcome,
} from '@/lib/data/campaigns';
import {
  getCampaignBillingSummary,
  getCampaignCreditTotal,
} from '@/lib/data/billing';
import { checkOsekPaturCeilingAfterCharge } from '@/lib/data/tax-ceiling';
import { captureHeldCardSumit } from '@/lib/sumit/capture';
import { SumitDeclinedError } from '@/lib/sumit/charge';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { requireAdmin } from '@/lib/auth/dal';

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
// retryable charge state proceeds to charge).
// Authorization: platform-admin only (billing operation).
export async function closeCampaignAndCharge(
  campaignId: string,
): Promise<CloseChargeOutcome> {
  await requireAdmin();
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

  // A charge needs the saved card token AND its expiry — SUMIT validates the
  // expiry structurally alongside the token (both captured at the J5 hold).
  if (
    campaign.capture_status !== 'authorized' ||
    !campaign.card_token_ref ||
    campaign.card_exp_month == null ||
    campaign.card_exp_year == null ||
    !campaign.card_citizen_id
  ) {
    return { outcome: 'bad_state', amount: 0 };
  }

  // Read the accrued total + credits. A real RPC/DB error here MUST route to
  // review — never to a 0 that would permanently settle the campaign at ₪0.
  let summary;
  let credits: number;
  try {
    summary = await getCampaignBillingSummary(campaignId);
    credits = await getCampaignCreditTotal(campaignId);
  } catch {
    await markCampaignChargeOutcome(campaignId, 'charge_review');
    return { outcome: 'review', amount: 0 };
  }

  const accrued = summary?.accrued ?? 0;
  const ceiling = campaign.max_charge_ceiling
    ? campaign.max_charge_ceiling
    : (summary?.ceiling ?? 0);
  // final = max(0, min(accrued, ceiling) − credits), rounded to agorot (§14/D5/G4).
  const capped = Math.min(accrued, ceiling);
  const amount = Math.max(0, Math.round((capped - credits) * 100) / 100);

  // 0 reached OR credits ≥ the capped total → settle at ₪0, no SUMIT call.
  if (amount <= 0) {
    await markCampaignChargeOutcome(campaignId, 'nothing_to_charge');
    return { outcome: 'nothing_to_charge', amount: 0 };
  }

  // Idempotency: only the caller that wins the atomic guard charges.
  const locked = await lockCampaignForCharge(campaignId);
  if (!locked) return { outcome: 'bad_state', amount };

  // The final charge emails a receipt to the billed party (the event owner).
  const adminCli = createAdminClient();
  let ownerEmail = '';
  const { data: ev } = await adminCli
    .from('events')
    .select('owner_id')
    .eq('id', campaign.event_id)
    .maybeSingle();
  if (ev?.owner_id) {
    const { data: u } = await adminCli.auth.admin.getUserById(
      ev.owner_id as string,
    );
    ownerEmail = u?.user?.email ?? '';
  }

  try {
    const result = await captureHeldCardSumit({
      companyId: sumit.companyId,
      apiKey: sumit.apiKey,
      cardToken: campaign.card_token_ref,
      expMonth: campaign.card_exp_month,
      expYear: campaign.card_exp_year,
      citizenId: campaign.card_citizen_id,
      externalRef: campaign.auth_external_ref ?? '',
      amount: amount.toString(),
      customerEmail: ownerEmail, // non-empty → SendDocumentByEmail:true (receipt)
    });
    await recordCampaignCharge(campaignId, {
      amount,
      documentId: result.documentId,
      documentNumber: result.documentNumber,
      documentUrl: result.documentUrl,
      authNumber: result.authNumber,
      paymentId: result.paymentId,
    });
    // Additive ops alert (fire-and-forget, fail-safe): non-PII ids/amount only.
    void sendSlackAlert({
      level: 'info',
      category: 'campaign_billing',
      source: 'close-charge',
      title: 'חיוב סופי בוצע',
      fields: {
        campaign_id: campaignId,
        event_id: campaign.event_id,
        amount,
        document_id: result.documentId,
      },
    });
    // Osek-patur turnover-ceiling watch (fire-and-forget, fail-safe): every
    // charged shekel counts fully toward the yearly VAT-exemption ceiling.
    void checkOsekPaturCeilingAfterCharge();
    return { outcome: 'charged', amount };
  } catch (e) {
    if (e instanceof SumitDeclinedError) {
      await markCampaignChargeOutcome(campaignId, 'charge_failed');
      // Additive ops alert (fire-and-forget, fail-safe): does not change the
      // decline outcome. The network/ambiguous branch below is intentionally
      // NOT alerted here (already covered by send_health in the SUMIT layer).
      void sendSlackAlert({
        level: 'warn',
        category: 'campaign_billing',
        source: 'close-charge',
        title: 'החיוב הסופי נדחה על ידי חברת האשראי',
        fields: { campaign_id: campaignId, event_id: campaign.event_id, amount },
      });
      return { outcome: 'declined', amount };
    }
    // Network / ambiguous → review, never silently retried (may have charged).
    await markCampaignChargeOutcome(campaignId, 'charge_review');
    return { outcome: 'review', amount };
  }
}
