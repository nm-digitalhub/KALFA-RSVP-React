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
import { isOpenCeilingAgreementVersion } from '@/lib/agreements/template';
import { getSignedAgreementVersion } from '@/lib/data/agreements';
import { isBaseFeeAgreementVersion } from '@/lib/agreements/template';
import { checkOsekPaturCeilingAfterCharge } from '@/lib/data/tax-ceiling';
import { captureHeldCardSumit } from '@/lib/sumit/capture';
import { SumitDeclinedError } from '@/lib/sumit/charge';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';

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

// Final settlement closes the event too, not just the campaign: once billing
// is final there is no reason for the public RSVP link to keep accepting
// responses (get_rsvp_by_token/submit_rsvp both gate on events.status =
// 'active'). The campaign is already closed by this point (CLOSEABLE branch
// above, or already 'closed' on retry), so the R7 trigger's operational-
// campaign guard never blocks this. Best-effort by design — never throws —
// because the charge/no-charge outcome above is already final and recorded;
// a failure here must not read back to the admin as a failed settlement.
// Re-checks the LIVE status first (mirrors event-cancellation.ts's
// adminCloseEvent) so a campaign settled AFTER the owner already closed the
// event themselves is a true no-op: without this, the activity log would
// record 'event.closed_by_settlement' as the closure reason even though
// settlement never actually closed anything — a real event never becomes
// attributable to the wrong cause.
async function closeEventAfterSettlement(eventId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: current } = await admin
      .from('events')
      .select('status')
      .eq('id', eventId)
      .maybeSingle();
    if (current?.status === 'closed') return;
    const { error } = await admin
      .from('events')
      .update({ status: 'closed' })
      .eq('id', eventId);
    if (error) return;
    await logActivity({
      eventId,
      action: 'event.closed_by_settlement',
      meta: {},
    });
  } catch {
    // best-effort — see comment above
  }
}

// Close a campaign and charge the held card for the flat-base + included +
// overage total. Fail-closed; server-derives amount = base + max(0, reached −
// included) × overage, minus credits, capped at the signed ceiling ONLY for a
// v4-and-earlier agreement (a frozen number in the PDF); v5+ states a formula
// and is not capped (see computeChargeAmount; base/included = 0 ⇒ pure per-reached, unchanged for
// pre-model campaigns); charges at most once (atomic guard); retry-tolerant
// (an already-closed campaign in a retryable charge state proceeds to charge).
// Authorization: platform-admin only (billing operation).
// opts.overrideAmount (cancellation-resolve flow only): replaces the computed
// total with an admin-confirmed amount, capped the same way — every
// other safety property (lock, terminal-state guard, receipt, D5 guard) is
// unchanged. Every existing caller omits opts and gets byte-identical behavior.
export async function closeCampaignAndCharge(
  campaignId: string,
  opts?: { overrideAmount?: number; overrideReason?: string },
): Promise<CloseChargeOutcome> {
  // `manage_billing`, not `requireAdmin()`. This function CLOSES A CAMPAIGN AND
// CHARGES THE SAVED CARD. `requireAdmin()` is the coarse `has_role('admin')`
// flag, which `support_agent` and `auditor` also hold — neither of which is
// meant to move money. `events.ts` and `packages.ts` already pin the same key
// for far less than a charge.
  await requirePlatformPermission('manage_billing');
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

  // The signed agreement version drives two decisions below: whether the base
  // fee may be billed (D5) and whether a frozen ceiling caps the total. A DB
  // error reading the signature must NOT terminally settle a wrong amount →
  // review, exactly like the summary/credit reads above.
  let signedVersion: string | null;
  try {
    signedVersion = await getSignedAgreementVersion(campaignId);
  } catch {
    await markCampaignChargeOutcome(campaignId, 'charge_review');
    return { outcome: 'review', amount: 0 };
  }

  // Flat-base + included + overage. base/included from the campaign SNAPSHOT
  // (S3 at authorize); NULL ⇒ 0 = pre-model / pre-S3 campaign ⇒ reduces to pure
  // per-reached (Σ reached × price_per_reached), verified behaviour-neutral for
  // the live campaigns. price_per_reached is the per-reached (overage) rate.
  //
  // Ceiling: an open-ceiling agreement (v5+) states the price as a formula of
  // the list, so nothing caps the total (the funded recipient cap was retired
  // 2026-09-25; `reached` may exceed what the hold covered, and every reached
  // contact is billed). A v4-and-earlier PDF states a frozen number the customer
  // relied on, so that number still caps. The 0/NULL → summary fallback keeps
  // the prior truthiness for those.
  const ceiling: number | null = isOpenCeilingAgreementVersion(signedVersion)
    ? null
    : campaign.max_charge_ceiling
      ? campaign.max_charge_ceiling
      : (summary?.ceiling ?? 0);

  // D5 GUARD — bind the base-fee to the SIGNED contract. The campaign may carry a
  // snapshotted base (the gate was on at authorize), but the activation fee
  // may be billed ONLY if the customer actually signed a base-fee agreement
  // version. Otherwise suppress base+included → pure per-reached, so a v3-signer
  // (whose contract says "0 → no charge") is NEVER charged the base regardless of
  // the global gate's state or timing.
  //   NOTE: suppression does NOT merely lower the amount — zeroing `included`
  //   removes the free tier, so per-reached gross can exceed the base+overage
  //   gross. The overcharge guarantee for those (v3 and earlier) signers is the
  //   hard cap: their PDF states a frozen ceiling and `ceiling` above is that
  //   number, so charge ≤ signed ceiling in every branch. Billing every reached
  //   contact with no free tier is precisely what a v3 signer's contract states
  //   (template §3).
  let effectiveBase = campaign.base_price ?? 0;
  let effectiveIncluded = campaign.included_reached ?? 0;
  if (effectiveBase > 0 || effectiveIncluded > 0) {
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

  // final = max(0, base + max(0, reached − included) × overage − credits),
  // capped at `ceiling` only when it is a number (§14/D5/G4).
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
  // Never allow it to exceed a frozen signed ceiling, regardless of the caller's
  // request (an open-ceiling agreement has none).
  const amount =
    opts?.overrideAmount !== undefined
      ? ceiling === null
        ? Math.max(0, opts.overrideAmount)
        : Math.min(Math.max(0, opts.overrideAmount), ceiling)
      : computed.amount;
  const creditApplied = opts?.overrideAmount !== undefined ? 0 : computed.creditApplied;

  // 0 reached OR credits ≥ the capped total OR overrideAmount===0 → settle at
  // ₪0, no SUMIT call.
  if (amount <= 0) {
    await markCampaignChargeOutcome(campaignId, 'nothing_to_charge', creditApplied);
    await closeEventAfterSettlement(campaign.event_id);
    return {
      outcome: 'nothing_to_charge',
      amount: 0,
      reachedCount: summary?.reachedCount ?? 0,
      creditApplied,
    };
  }

  // Receipt breakdown — the SAME numbers the amount above was computed from, so
  // the customer's receipt shows where the total came from instead of one opaque
  // "חיוב קמפיין" line. Built ONLY for the computed path: an admin override
  // replaces the total outright, so there is no breakdown that honestly
  // describes it.
  //
  // This is presentation, never arithmetic: captureHeldCardSumit re-checks that
  // the rows sum to `amount` and silently falls back to the single line if they
  // do not (e.g. a frozen ceiling bound and the gross no longer matches). So a
  // mistake here costs receipt detail, never a wrong charge.
  const overageCount =
    opts?.overrideAmount !== undefined
      ? 0
      : Math.max(0, (summary?.reachedCount ?? 0) - effectiveIncluded);
  const overageRate = campaign.price_per_reached ?? 0;
  const receiptLines =
    opts?.overrideAmount !== undefined
      ? undefined
      : [
          ...(effectiveBase > 0
            ? [{ name: 'דמי הפעלה', quantity: 1, unitPrice: effectiveBase }]
            : []),
          ...(overageCount > 0 && overageRate > 0
            ? [
                {
                  name:
                    effectiveIncluded > 0
                      ? 'אנשי קשר שנענו מעבר לכמות הכלולה'
                      : 'אנשי קשר שנענו',
                  quantity: overageCount,
                  unitPrice: overageRate,
                },
              ]
            : []),
          // The credit as its own negative row (SUMIT support, 2026-09-22).
          // Only ever one, which is what linesReconcile allows.
          ...(creditApplied > 0
            ? [{ name: 'קרדיט', quantity: 1, unitPrice: -creditApplied }]
            : []),
        ];

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
      customerId: campaign.sumit_customer_id,
      lines: receiptLines,
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
    await closeEventAfterSettlement(campaign.event_id);
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
