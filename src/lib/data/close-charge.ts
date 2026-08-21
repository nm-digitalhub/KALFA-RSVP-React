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
import { computeChargeAmount } from '@/lib/data/close-charge-amount';
import { getSignedAgreementVersion } from '@/lib/data/agreements';
import { isBaseFeeAgreementVersion } from '@/lib/agreements/template';
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
  // Present only on 'charged': the provider's per-charge payment id — the
  // analytics transaction_id (never the campaign id). null when the provider
  // response carried no id.
  paymentId?: number | null;
  // Present only on 'charged': the billing model actually applied AFTER the
  // D5 guard — a coarse analytics label, never an amount.
  billingModel?: 'base_overage' | 'per_reached';
  // Present only on 'nothing_to_charge': how many contacts were actually
  // reached and how much credit covered them. amount===0 alone does NOT mean
  // nobody was reached — it also fires when credits fully cover a nonzero
  // reached total (reachedCount>0 && creditApplied>0). Callers must not
  // infer "no contacts reached" from amount===0 without checking reachedCount.
  reachedCount?: number;
  creditApplied?: number;
  // Present only on 'charged': the receipt document captureHeldCardSumit
  // already returns — surfaced here so a caller (the cancellation-resolve
  // flow) can put the receipt link in a customer-facing message without a
  // second DB read.
  documentId?: number | null;
  documentUrl?: string | null;
};

const CLOSEABLE = ['active', 'paused', 'approved', 'scheduled'];

// Close a campaign and charge the held card for the flat-base + included +
// overage total. Fail-closed; server-derives amount = base + max(0, reached −
// included) × overage, capped at the signed ceiling, minus credits (see
// computeChargeAmount; base/included = 0 ⇒ pure per-reached, unchanged for
// pre-model campaigns); charges at most once (atomic guard); retry-tolerant
// (an already-closed campaign in a retryable charge state proceeds to charge).
// Authorization: platform-admin only (billing operation).
// opts.overrideAmount (cancellation-resolve flow only): replaces the computed
// total with an admin-confirmed amount, still capped at the ceiling — every
// other safety property (lock, terminal-state guard, receipt, D5 guard) is
// unchanged. Every existing caller omits opts and gets byte-identical behavior.
export async function closeCampaignAndCharge(
  campaignId: string,
  opts?: { overrideAmount?: number; overrideReason?: string },
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

  // Terminal charge outcomes are final: a charged (or credit-settled) campaign
  // can never be re-charged NOR re-marked nothing_to_charge (which would zero
  // the recorded amount). Retryable states (charge_failed/charge_review) pass.
  if (
    campaign.charge_status === 'charged' ||
    campaign.charge_status === 'nothing_to_charge'
  ) {
    return { outcome: 'bad_state', amount: 0 };
  }

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
    credits = await getCampaignCreditTotal(campaignId, campaign.event_id);
  } catch {
    await markCampaignChargeOutcome(campaignId, 'charge_review');
    return { outcome: 'review', amount: 0 };
  }

  // Flat-base + included + overage. base/included from the campaign SNAPSHOT
  // (S3 at authorize); NULL ⇒ 0 = pre-model / pre-S3 campaign ⇒ reduces to pure
  // per-reached (Σ reached × price_per_reached), verified behaviour-neutral for
  // the live campaigns. price_per_reached is the per-reached (overage) rate. The
  // ceiling fallback preserves the prior truthiness (0/NULL → summary ceiling).
  const ceiling = campaign.max_charge_ceiling
    ? campaign.max_charge_ceiling
    : (summary?.ceiling ?? 0);

  // D5 GUARD — bind the base-fee to the SIGNED contract. The campaign may carry a
  // snapshotted base (the gate was on at authorize), but the ₪200 activation fee
  // may be billed ONLY if the customer actually signed a base-fee agreement
  // version. Otherwise suppress base+included → pure per-reached, so a v3-signer
  // (whose contract says "0 → no charge") is NEVER charged the base regardless of
  // the global gate's state or timing.
  //   NOTE: suppression does NOT merely lower the amount — zeroing `included`
  //   removes the free tier, so per-reached gross can exceed the base+overage
  //   gross. The overcharge guarantee is NOT "always lower"; it is the hard cap:
  //   computeChargeAmount caps at `ceiling` = the exact number in the signed PDF
  //   (agreements.ts passes campaign.max_charge_ceiling), so charge ≤ signed
  //   ceiling in every branch. Billing every reached contact with no free tier is
  //   precisely what a v3 signer's contract states (template §3).
  let effectiveBase = campaign.base_price ?? 0;
  let effectiveIncluded = campaign.included_reached ?? 0;
  if (effectiveBase > 0 || effectiveIncluded > 0) {
    let signedVersion: string | null;
    try {
      signedVersion = await getSignedAgreementVersion(campaignId);
    } catch {
      // A real DB error reading the signature must NOT terminally settle a wrong
      // amount — route to review, exactly like the summary/credit reads above.
      await markCampaignChargeOutcome(campaignId, 'charge_review');
      return { outcome: 'review', amount: 0 };
    }
    if (!isBaseFeeAgreementVersion(signedVersion)) {
      effectiveBase = 0;
      effectiveIncluded = 0;
      // Security/billing audit (fire-and-forget, fail-safe): a base snapshot that
      // the signed contract does not authorize indicates a config/ordering issue
      // (e.g. gate flipped before the v4 agreement went active) — surface it.
      void sendSlackAlert({
        level: 'warn',
        category: 'campaign_billing',
        source: 'close-charge-d5-guard',
        title: 'D5 guard: base fee suppressed — signed agreement is not a base-fee version',
        fields: {
          campaign_id: campaignId,
          event_id: campaign.event_id,
          signed_version: signedVersion ?? 'none',
        },
      });
    }
  }

  // final = max(0, min(base + max(0, reached − included) × overage, ceiling) −
  // credits), rounded to agorot (§14/D5/G4).
  const computed = computeChargeAmount({
    base: effectiveBase,
    included: effectiveIncluded,
    overage: campaign.price_per_reached ?? 0,
    reached: summary?.reachedCount ?? 0,
    ceiling,
    credits,
  });

  // Override path (cancellation-resolve only): an admin-confirmed amount
  // REPLACES the computed reached×price total, but every safety property
  // below (idempotency lock, terminal-state guard, receipt generation,
  // Slack alert, D5 guard already applied above) still applies identically —
  // overrideAmount only swaps WHAT gets charged, never HOW it gets charged.
  // Never allow it to exceed the signed ceiling, regardless of the caller's
  // request.
  const amount =
    opts?.overrideAmount !== undefined
      ? Math.min(Math.max(0, opts.overrideAmount), ceiling)
      : computed.amount;
  const creditApplied = opts?.overrideAmount !== undefined ? 0 : computed.creditApplied;

  // 0 reached OR credits ≥ the capped total OR overrideAmount===0 → settle at
  // ₪0, no SUMIT call.
  if (amount <= 0) {
    await markCampaignChargeOutcome(campaignId, 'nothing_to_charge', creditApplied);
    return {
      outcome: 'nothing_to_charge',
      amount: 0,
      reachedCount: summary?.reachedCount ?? 0,
      creditApplied,
    };
  }

  // Idempotency: only the caller that wins the atomic guard charges.
  const locked = await lockCampaignForCharge(campaignId);
  if (!locked) return { outcome: 'bad_state', amount };

  // The final charge emails a receipt to the billed party (the event owner).
  const adminCli = createAdminClient();
  let ownerEmail = '';
  let ownerName = '';
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
    // Receipt "לכבוד" — same fallback chain the signed agreement uses
    // (profiles.full_name → email); without a name SUMIT prints "כרטיס ללא שם".
    const { data: prof } = await adminCli
      .from('profiles')
      .select('full_name')
      .eq('id', ev.owner_id as string)
      .maybeSingle();
    ownerName = (prof?.full_name ?? '').trim() || ownerEmail;
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
      customerName: ownerName,
    });
    await recordCampaignCharge(campaignId, {
      amount,
      creditApplied,
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
        credit_applied: creditApplied,
        document_id: result.documentId,
        ...(opts?.overrideReason ? { override_reason: opts.overrideReason } : {}),
      },
    });
    // Osek-patur turnover-ceiling watch (fire-and-forget, fail-safe): every
    // charged shekel counts fully toward the yearly VAT-exemption ceiling.
    void checkOsekPaturCeilingAfterCharge();
    // paymentId = the provider's per-charge id — the ONLY valid analytics
    // transaction_id (campaign ids repeat across retries/refunds).
    return {
      outcome: 'charged',
      amount,
      paymentId: result.paymentId ?? null,
      billingModel:
        effectiveBase > 0 || effectiveIncluded > 0 ? 'base_overage' : 'per_reached',
      documentId: result.documentId ?? null,
      documentUrl: result.documentUrl ?? null,
    };
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
