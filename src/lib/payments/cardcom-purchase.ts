import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { buildCreateLowProfile } from '@/lib/cardcom/create-request';
import { lowProfileCreate } from '@/lib/cardcom/generated/low-profile/low-profile';
import { getCampaignCreditTotal } from '@/lib/data/billing';
import type { CampaignPurchaseState } from '@/lib/data/campaigns';
import { getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { getPackageModelEnabled, getPaymentsEnabled } from '@/lib/data/payments';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';
import { getAppUrl } from '@/lib/url';

import { CARDCOM_ABANDON_AFTER_MINUTES, settleCardcomSession } from './cardcom-settle';
import { beginOperation, completeOperation } from './ledger';
import { getPackagePaymentState } from './package-paid';
import { RECEIPT_DESCRIPTION } from './package-receipt';
import { resolvePurchaseProvider } from './provider';

// Opens a CardCom Open Fields payment session for a fixed-price package purchase (docs/superpowers/plans/
// 2026-10-07-cardcom-pilot-plan.md, 4.3). The CardCom counterpart of purchasePackage (package-purchase.ts), with the same
// safety argument in the same order:
//   1. every gate is fail-closed (payments, the package switch, the CardCom connection, the test-terminal rule);
//   2. the amount is the campaign's own `package_price`, read by the caller from the database — never browser input;
//   3. the PENDING ledger row is written BEFORE CardCom is asked for anything; the database (one pending row per campaign
//      + kind, and "once per campaign") is what makes a double click or a second tab impossible;
//   4. a failure to OPEN the session closes that row as failed. That is safe for CardCom, unlike a charge: with no
//      LowProfileId in the buyer's hands nothing can be paid, so nothing can have been charged.
//
// What it returns is only a LowProfileId. The browser needs nothing else to start the Open Fields form, and never gets a
// URL, a credential or the price: the payment is decided later by settleCardcomSession, from CardCom's own answer.
//
// It does not charge, and it does not activate the campaign: settleCardcomSession records the payment, and the settle
// route (the buyer's own session) activates.

export type CardcomStartOutcome =
  | { status: 'ready'; lowProfileId: string }
  | { status: 'already_paid' } // a purchase already succeeded — nothing to open
  | { status: 'in_progress' } // another attempt is open, or being settled
  | { status: 'review' } // a payment that needs a person
  | { status: 'disabled' } // a gate is closed
  | { status: 'not_purchasable' } // not a signed package campaign, no usable price, or it was refunded
  | { status: 'credit_unsupported' } // the event holds unspent credit and deducting it is not built yet
  | { status: 'error' }; // something failed BEFORE any payment could happen

export type CardcomStartInput = {
  campaign: CampaignPurchaseState;
  /** The account that will type the card. Its id is recorded so a refund knows who paid. */
  payer: { userId: string; email: string; name: string; phone?: string | null };
  /** True for someone who may configure the integration: the only buyer allowed on CardCom's test terminal. */
  mayUseTestTerminal: boolean;
};

const CREATE_TIMEOUT_MS = 10_000;
const CATEGORY = 'campaign_billing' as const;
const SOURCE = 'cardcom-purchase';

type AdminClient = ReturnType<typeof createAdminClient>;

const asMeta = (meta: Json): { [key: string]: Json | undefined } =>
  meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};

// Best-effort closing of a row whose session never reached the buyer. A failure here is loud, not fatal: the row stays
// pending and the sweeper settles it from CardCom's side.
async function closeFailed(admin: AdminClient, operationId: string, note: string, details: { status?: string; description?: string | null } = {}): Promise<void> {
  try {
    await completeOperation(admin, operationId, {
      from: 'pending',
      outcome: 'failed',
      note,
      ...(details.status === undefined ? {} : { providerStatus: details.status, providerStatusDescription: details.description ?? null }),
    });
  } catch {
    console.error('[cardcom-purchase] could not close the payment row; the sweeper will settle it', { operationId });
  }
}

// A pending purchase on this campaign: whose is it, and is it still alive? Only a CardCom session can be asked.
//   resume       it is the buyer's own, young and unpaid: the SAME session is handed back (a reload, a second tab, a double
//                click). Nothing new is written and CardCom is not asked to open another page.
type Pending = { next: 'proceed' | 'already_paid' | 'in_progress' | 'review' } | { next: 'resume'; lowProfileId: string };
async function resolvePending(admin: AdminClient, campaignId: string): Promise<Pending> {
  const { data: pending, error } = await admin
    .from('payment_operations')
    .select('id, recorded_at, meta')
    .eq('campaign_id', campaignId)
    .eq('kind', 'package_purchase')
    .eq('outcome', 'pending')
    .maybeSingle();
  if (error) return { next: 'in_progress' };
  if (!pending) return { next: 'proceed' };
  // A SUMIT charge in flight, or a row whose session was never recorded: not ours to judge.
  if (asMeta(pending.meta).provider !== 'cardcom') return { next: 'in_progress' };
  const { data: session } = await admin.from('cardcom_payment_sessions').select('low_profile_id').eq('operation_id', pending.id).maybeSingle();
  if (!session) return { next: 'in_progress' };

  const ageMinutes = (Date.now() - Date.parse(pending.recorded_at)) / 60_000;
  const settled = await settleCardcomSession(session.low_profile_id, { finalizeUnpaid: ageMinutes > CARDCOM_ABANDON_AFTER_MINUTES });
  if (settled.status === 'unpaid') return { next: 'resume', lowProfileId: session.low_profile_id }; // young and unpaid: still the buyer's
  if (settled.status !== 'settled') return { next: 'in_progress' }; // unreadable, or not found: never overwrite on a guess
  if (settled.outcome === 'succeeded') return { next: 'already_paid' };
  if (settled.outcome === 'review') return { next: 'review' };
  return { next: 'proceed' }; // failed: the buyer may try again
}

export async function startCardcomPurchase(input: CardcomStartInput): Promise<CardcomStartOutcome> {
  const { campaign, payer } = input;
  const campaignId = campaign.id;

  // 1. Gates. Each reader resolves to "off / not configured" on any error.
  const [paymentsOn, packageOn, config] = await Promise.all([getPaymentsEnabled(), getPackageModelEnabled(), getCardcomServerConfig()]);
  if (!paymentsOn || !packageOn || !config) return { status: 'disabled' };
  if (resolvePurchaseProvider(config, input.mayUseTestTerminal) !== 'cardcom') return { status: 'disabled' };

  // 2. A fixed price. NULL is a pay-per-result campaign: it must never be charged here.
  const price = campaign.package_price == null ? Number.NaN : Number(campaign.package_price);
  if (!Number.isFinite(price) || price <= 0) return { status: 'not_purchasable' };

  const admin = createAdminClient();

  // 3a. What the ledger already says — BEFORE the campaign's own state, so a payment that exists is always reported as
  // such. The database's unique indexes are the authority; this read only gives the buyer the right answer.
  try {
    const state = await getPackagePaymentState(campaignId);
    switch (state.status) {
      case 'none':
      case 'declined':
        break;
      case 'collected':
        return { status: 'already_paid' };
      case 'review':
        return { status: 'review' };
      case 'pending': {
        const pending = await resolvePending(admin, campaignId);
        if (pending.next === 'resume') return { status: 'ready', lowProfileId: pending.lowProfileId };
        if (pending.next !== 'proceed') return { status: pending.next };
        break;
      }
      default:
        return { status: 'not_purchasable' };
    }
  } catch {
    console.error('[cardcom-purchase] payment ledger could not be read; nothing was opened', { campaignId });
    return { status: 'error' };
  }

  // The campaign itself: signed, and carrying no old-style payment.
  if (campaign.status !== 'approved' || campaign.capture_status != null || campaign.charge_status != null) {
    return { status: 'not_purchasable' };
  }

  // Credit the buyer already holds would have to come off the price; deducting it is not built, so refuse rather than overcharge.
  try {
    if ((await getCampaignCreditTotal(campaignId, campaign.event_id)) > 0) return { status: 'credit_unsupported' };
  } catch {
    console.error('[cardcom-purchase] credit lookup failed; nothing was opened', { campaignId });
    return { status: 'error' };
  }

  // 3b. Take the lock: the PENDING row, before CardCom is asked for anything.
  const lines = [{ description: RECEIPT_DESCRIPTION, unitPrice: price }];
  let operationId: string;
  try {
    const begun = await beginOperation(admin, {
      campaignId,
      eventId: campaign.event_id,
      kind: 'package_purchase',
      amount: price,
      lines,
      meta: { payerUserId: payer.userId, provider: 'cardcom' },
    });
    if ('alreadyInProgress' in begun) return { status: 'in_progress' };
    operationId = begun.id;
  } catch {
    console.error('[cardcom-purchase] could not take the payment lock; nothing was opened', { campaignId });
    return { status: 'error' };
  }

  // 4. Open the session.
  let lowProfileId: string;
  try {
    const request = buildCreateLowProfile({
      terminalNumber: config.terminalNumber,
      apiName: config.apiName,
      operationId,
      lines,
      payer,
      webhookUrl: await getAppUrl('/api/cardcom/webhook'),
      returnUrl: await getAppUrl(`/app/events/${campaign.event_id}/campaign/${campaignId}/payment`),
    });
    const answer = await lowProfileCreate(request, { cardcom: { timeoutMs: CREATE_TIMEOUT_MS } });
    if (answer.ResponseCode !== 0 || typeof answer.LowProfileId !== 'string' || answer.LowProfileId === '') {
      console.error('[cardcom-purchase] CardCom refused to open a session', { campaignId, operationId });
      await closeFailed(admin, operationId, 'CardCom did not open a payment session; nothing was charged', {
        status: String(answer.ResponseCode),
        // CardCom's own text: for the ledger and an admin, never for the buyer.
        description: answer.Description ?? null,
      });
      void sendSlackAlert({
        level: 'error', category: CATEGORY, source: SOURCE,
        title: 'CardCom סירבה לפתוח עמוד תשלום לרכישת חבילה',
        fields: { campaign_id: campaignId, event_id: campaign.event_id, operation_id: operationId },
      });
      return { status: 'error' };
    }
    lowProfileId = answer.LowProfileId;
  } catch {
    // The call did not complete: no id reached the buyer, so nothing can be paid on it.
    console.error('[cardcom-purchase] could not open a CardCom session', { campaignId, operationId });
    await closeFailed(admin, operationId, 'could not reach CardCom to open a payment session; nothing was charged');
    return { status: 'error' };
  }

  // 5. Tie the session to the operation. Without this row a payment could not be matched to its operation, so the buyer
  // is not given the id when it cannot be written.
  const { error: sessionError } = await admin.from('cardcom_payment_sessions').insert({ low_profile_id: lowProfileId, operation_id: operationId });
  if (sessionError) {
    console.error('[cardcom-purchase] could not record the session; the buyer was not given it', { campaignId, operationId });
    await closeFailed(admin, operationId, 'the payment session could not be recorded; the buyer was never given it');
    return { status: 'error' };
  }
  return { status: 'ready', lowProfileId };
}
