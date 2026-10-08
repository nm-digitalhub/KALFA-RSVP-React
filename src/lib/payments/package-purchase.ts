import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { logActivity } from '@/lib/data/activity';
import { getCampaignCreditTotal } from '@/lib/data/billing';
import type { CampaignPurchaseState } from '@/lib/data/campaigns';
import { getPackageModelEnabled, getPaymentsEnabled, getSumitServerConfig } from '@/lib/data/payments';
import { getSumitCustomerId, recordSumitCustomerId } from '@/lib/data/sumit-customers';
import { checkOsekPaturCeilingAfterCharge } from '@/lib/data/tax-ceiling';
import { chargeSumit, SumitDeclinedError, type SumitChargeResult } from '@/lib/sumit/charge';
import { createAdminClient } from '@/lib/supabase/admin';

import { cardFromSumit, saveCitizenId, type CardDetails } from './card';
import { beginOperation, completeOperation, type ProviderDocument } from './ledger';
import { getPackagePaymentState } from './package-paid';
import { RECEIPT_DESCRIPTION } from './package-receipt';

// The fixed-price package PURCHASE (docs/superpowers/plans/2026-10-04-package-payment-plan.md, P-B): one real charge
// for the whole package, recorded in the payment ledger. The caller (the purchase route) has already verified who the
// payer is, that they own the event, and that the event is still open; everything that decides whether MONEY MOVES
// is here, so no other caller can reach the charge without these gates.
//
// The order is the safety argument:
//   1. every gate is fail-closed (payments, the package switch, the provider configuration);
//   2. the amount is the campaign's own `package_price`, read by the caller from the database — never browser input;
//   3. the PENDING ledger row is written BEFORE the provider is asked for money. The database (one pending row per
//      campaign + kind, and "once per campaign") is what makes a double click, a second tab or a retry impossible;
//   4. a clear decline closes the row as failed, and the customer may try again. Anything else — the network, a
//      timeout, an answer we cannot classify, a charge confirmed but not recorded — goes to REVIEW and is never
//      retried automatically: the card may already have been charged;
//   5. once SUMIT has confirmed the charge, nothing that comes after it can undo it. A failure of the card vault, the
//      customer-number anchor or the audit row is logged and the payment stays recorded.
// Activation is not done here: the route calls activateCampaign after a paid outcome, which requires the recorded
// payment and fills the guest list itself.

// The ledger-derived state lives in ./package-paid (a light module the campaign layer can import); re-exported so the
// payment page keeps importing it from here.
export { getPackagePaymentState };

export type PurchaseOutcome =
  | 'paid' // charged now, and recorded
  | 'already_paid' // a purchase already succeeded — nothing was charged
  | 'in_progress' // another attempt is in flight
  | 'review' // a charge that needs a person (this attempt's, or an earlier one's)
  | 'declined' // the issuer or SUMIT refused; nothing was charged
  | 'disabled' // a gate is closed
  | 'not_purchasable' // not a signed package campaign, or no usable price, or it was refunded
  | 'credit_unsupported' // the event holds unspent credit and deducting it is not built yet
  | 'error'; // something failed BEFORE any charge; nothing was charged

export interface PackagePurchaseInput {
  campaign: CampaignPurchaseState;
  // The account that typed the card. Its id is recorded on the row so an upgrade or a refund uses that account's
  // customer number even when another member of the organisation presses the button.
  payer: { userId: string; email: string; name: string };
  // The single-use token payments.js produced in the browser.
  ogToken: string;
}

const DECLINED_NOTE = 'declined by the card issuer or the provider; nothing was charged';
const UNCLEAR_NOTE = 'the provider\'s answer was unclear; the card may have been charged — check the provider before any retry';
const UNRECORDED_NOTE = 'the provider confirmed the charge but it could not be recorded as succeeded — confirm in the provider, then resolve';

type AdminClient = ReturnType<typeof createAdminClient>;

const CATEGORY = 'campaign_billing' as const;
const SOURCE = 'package-purchase';

// Best-effort completion of a row whose outcome is already certain from the provider's side. A failure here is loud,
// not fatal: the row stays pending and the orphan sweeper moves it to review within ten minutes.
async function settle(
  admin: AdminClient,
  operationId: string,
  campaignId: string,
  result: Parameters<typeof completeOperation>[2],
): Promise<boolean> {
  try {
    await completeOperation(admin, operationId, result);
    return true;
  } catch (err) {
    console.error('[package-purchase] could not close the payment row; the orphan sweeper will move it to review', {
      campaignId,
      operationId,
      wanted: result.outcome,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// The holder id (ת"ז) goes to the vault; the row keeps only the secret's id. If the vault write fails the card is kept
// without it: the charge is already confirmed, and an upgrade will ask for the card again.
async function cardToKeep(
  admin: AdminClient,
  campaignId: string,
  operationId: string,
  paymentMethod: SumitChargeResult['paymentMethod'],
): Promise<CardDetails | null> {
  const card = cardFromSumit(paymentMethod);
  if (!card) return null;
  let citizenSecretId: string | null = null;
  try {
    citizenSecretId = await saveCitizenId(admin, campaignId, paymentMethod?.CreditCard_CitizenID ?? null);
  } catch {
    console.error('[package-purchase] the holder id could not be stored; the card is kept without it', {
      campaignId,
      operationId,
    });
  }
  return { ...card, citizenSecretId };
}

function documentOf(charged: SumitChargeResult): ProviderDocument {
  return { id: charged.documentId, number: charged.documentNumber, url: charged.documentUrl };
}

export async function purchasePackage(input: PackagePurchaseInput): Promise<PurchaseOutcome> {
  const { campaign, payer, ogToken } = input;
  const campaignId = campaign.id;

  // 1. Gates. Each reader resolves to "off / not configured" on any error.
  const [paymentsOn, packageOn, sumit] = await Promise.all([
    getPaymentsEnabled(),
    getPackageModelEnabled(),
    getSumitServerConfig(),
  ]);
  if (!paymentsOn || !packageOn) return 'disabled';
  if (!sumit) {
    console.error('[package-purchase] enabled but the provider configuration is missing', { campaignId });
    return 'disabled';
  }

  // 2. A fixed price. NULL is a pay-per-result campaign: it must never be charged here.
  const price = campaign.package_price == null ? Number.NaN : Number(campaign.package_price);
  if (!Number.isFinite(price) || price <= 0) return 'not_purchasable';

  // The only reads and writes below go through the service-role client: the ledger has no grant for the browser.
  const admin = createAdminClient();

  // 3a. What the ledger already says — BEFORE the campaign's own state, so a payment that exists is always reported
  // as such (a campaign that moved on after paying, or later received a credit, still answers "paid"). The
  // database's unique indexes are the authority; this read only gives the customer the right answer.
  try {
    const state = await getPackagePaymentState(campaignId);
    switch (state.status) {
      case 'none':
      case 'declined':
        break;
      case 'collected':
        return 'already_paid';
      case 'pending':
        return 'in_progress';
      case 'review':
        return 'review';
      default:
        return 'not_purchasable';
    }
  } catch {
    console.error('[package-purchase] payment ledger could not be read; nothing was charged', { campaignId });
    return 'error';
  }

  // The campaign itself: signed, and carrying no old-style payment. A card hold or a final-charge state on the same
  // row means two money mechanisms on one campaign, and the ledger cannot see the old one.
  if (campaign.status !== 'approved' || campaign.capture_status != null || campaign.charge_status != null) {
    return 'not_purchasable';
  }

  // Credit the customer already holds would have to come off the price. Deducting it (and marking it spent) is not
  // built, and charging the full price would overcharge — so a customer with credit is refused, not overcharged.
  try {
    if ((await getCampaignCreditTotal(campaignId, campaign.event_id)) > 0) return 'credit_unsupported';
  } catch {
    console.error('[package-purchase] credit lookup failed; nothing was charged', { campaignId });
    return 'error';
  }

  // 3b. Take the lock: the PENDING row, before the provider is called.
  const knownCustomerId = await getSumitCustomerId(payer.userId);
  let operationId: string;
  try {
    const begun = await beginOperation(admin, {
      campaignId,
      eventId: campaign.event_id,
      kind: 'package_purchase',
      amount: price,
      // What the price is made of, on record before the provider is asked. One line today; a credit that comes off the
      // price will be a second, negative line (see 'credit_unsupported' above).
      lines: [{ description: RECEIPT_DESCRIPTION, unitPrice: price }],
      meta: { payerUserId: payer.userId },
    });
    if ('alreadyInProgress' in begun) return 'in_progress';
    operationId = begun.id;
  } catch {
    console.error('[package-purchase] could not take the payment lock; nothing was charged', { campaignId });
    return 'error';
  }

  // 4. The charge.
  let charged: SumitChargeResult;
  try {
    charged = await chargeSumit({
      companyId: sumit.companyId,
      apiKey: sumit.apiKey,
      ogToken,
      amount: price.toFixed(2), // numeric → string only at the SUMIT boundary
      description: RECEIPT_DESCRIPTION,
      externalRef: operationId,
      customerEmail: payer.email,
      customerName: payer.name,
      customerId: knownCustomerId,
    });
  } catch (err) {
    if (err instanceof SumitDeclinedError) {
      console.error('[package-purchase] declined', { campaignId, operationId });
      await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: DECLINED_NOTE });
      void sendSlackAlert({
        level: 'warn',
        category: CATEGORY,
        source: SOURCE,
        title: 'רכישת חבילה נדחתה על ידי חברת האשראי',
        fields: { campaign_id: campaignId, event_id: campaign.event_id, operation_id: operationId },
      });
      return 'declined';
    }
    // Unknown outcome (network, timeout, an answer we cannot classify): the card may have been charged.
    console.error('[package-purchase] ambiguous outcome', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: UNCLEAR_NOTE });
    void sendSlackAlert({
      level: 'error',
      category: CATEGORY,
      source: SOURCE,
      title: 'רכישת חבילה בבדיקה ידנית — התשובה מחברת האשראי לא חד-משמעית',
      fields: { campaign_id: campaignId, event_id: campaign.event_id, operation_id: operationId },
    });
    return 'review';
  }

  // 5. SUMIT confirmed the charge. Record it; from here nothing may undo it.
  const card = await cardToKeep(admin, campaignId, operationId, charged.paymentMethod);
  try {
    await completeOperation(admin, operationId, {
      from: 'pending',
      outcome: 'succeeded',
      providerPaymentId: charged.paymentId,
      providerAuthRef: charged.authNumber,
      providerStatus: charged.status,
      providerStatusDescription: charged.statusDescription,
      providerDocument: documentOf(charged),
      card,
    });
  } catch (err) {
    // Real money, confirmed by the provider, not recorded: log only the reconciliation anchors (never the card
    // token, the expiry or the holder id), try to park the row in review WITH the provider references so the person
    // who resolves it has them, and alert. The customer is told it is being checked, never to pay again.
    console.error('[package-purchase] CONFIRMED charge could not be recorded — manual reconciliation required', {
      campaignId,
      operationId,
      documentNumber: charged.documentNumber,
      paymentId: charged.paymentId,
      error: err instanceof Error ? err.message : String(err),
    });
    await settle(admin, operationId, campaignId, {
      from: 'pending',
      outcome: 'review',
      providerPaymentId: charged.paymentId,
      providerAuthRef: charged.authNumber,
      providerStatus: charged.status,
      providerStatusDescription: charged.statusDescription,
      providerDocument: documentOf(charged),
      note: UNRECORDED_NOTE,
    });
    void sendSlackAlert({
      level: 'error',
      category: CATEGORY,
      source: SOURCE,
      title: 'חיוב חבילה אושר בסאמיט אך לא נשמר — נדרשת התאמה ידנית',
      fields: {
        campaign_id: campaignId,
        event_id: campaign.event_id,
        operation_id: operationId,
        document_number: charged.documentNumber ?? 'none',
      },
    });
    return 'review';
  }

  // 6. Follow-ups, each best-effort: the payment is recorded and must not be affected by any of them.
  if (charged.sumitCustomerId != null) {
    try {
      await recordSumitCustomerId({ userId: payer.userId, sumitCustomerId: charged.sumitCustomerId, campaignId });
    } catch {
      console.error('[package-purchase] sumit_customers anchor write failed (non-fatal)', { campaignId });
    }
  }
  try {
    await logActivity({
      eventId: campaign.event_id,
      action: 'campaign.package_purchased',
      meta: { campaignId, operationId, amount: price, documentNumber: charged.documentNumber },
    });
  } catch {
    console.error('[package-purchase] logActivity failed (non-fatal)', { campaignId });
  }
  // The revenue just grew: re-check the year's turnover against the עוסק פטור ceiling. Fire-and-forget — the check never
  // throws or rejects (tax-ceiling.ts), and it must not hold up or change this outcome.
  void checkOsekPaturCeilingAfterCharge();

  return 'paid';
}
