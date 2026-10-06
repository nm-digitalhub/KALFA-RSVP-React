import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { logActivity } from '@/lib/data/activity';
import { getPaymentsEnabled, getSumitServerConfig } from '@/lib/data/payments';
import { getSumitCustomerId } from '@/lib/data/sumit-customers';
import { accountingDocumentsSend, billingPaymentsCharge } from '@/lib/sumit/generated/api';
import { OfficeGuyAppsBillingMVCAPITypedPaymentMethodType } from '@/lib/sumit/generated/api.schemas';
import { SumitError } from '@/lib/sumit/mutator';
import { createAdminClient } from '@/lib/supabase/admin';

import { readCitizenId } from './card';
import {
  beginOperation,
  completeOperation,
  currentCard,
  getOperation,
  latestOperation,
  loadOperations,
  refundsOfRequest,
  type ProviderDocument,
} from './ledger';
import { refundableAmount, refundableCents } from './status';

// Giving a customer's money back for a fixed-price package (docs/superpowers/plans/2026-10-06-package-cancel-refund.md).
// The mirror image of package-purchase.ts, and the same safety argument, in the same order:
//   1. every gate is fail-closed (payments on, the provider configured);
//   2. the amount is checked against the LEDGER — what the card actually paid minus what already went back, refunds
//      still pending or in review counted as gone — never against anything the admin or the browser typed;
//   3. a refund of one cancellation request is made ONCE: an earlier succeeded refund of the same request is returned
//      as it is (so a retry after a half-finished resolve cannot refund twice), and one still pending or in review
//      stops this attempt before it starts. The database backs this up (cancellation_uq, one_pending_uq);
//   4. the PENDING ledger row is written BEFORE SUMIT is asked to move any money, and the limit is checked AGAIN once
//      the row is held — the first check and the row are not one atomic step, the held row is;
//   5. a clear refusal closes the row as failed, and the refund may be tried again. Anything else — the network, a
//      timeout, an answer we cannot classify, an answer that does not look like the credit we asked for — goes to
//      REVIEW and is never retried by this code: the money may already be back;
//   6. once SUMIT has confirmed the credit nothing that comes after it can undo it: a failure to send the credit
//      document, to write the audit row or the alert is logged and the refund stays recorded.
// The mechanism (billing/payments/charge, SupportCredit:true, ONE negative item, the saved token, the same customer)
// was proven live on 6.10.2026 with a ₪1 credit. Never logs a token, a holder id or the API key.

// Customer-facing (it prints on the credit document): the product, not the price or any provider.
const REFUND_LINE = 'KALFA — זיכוי ביטול חבילת אישורי הגעה לאירוע';

const DECLINED_NOTE = 'declined by the provider or the card issuer; nothing was returned';
const UNCLEAR_NOTE = 'the provider\'s answer was unclear; the money may have been returned — check the provider before any retry';
const UNLOCKED_NOTE = 'more than the card paid would have been returned; nothing was sent to the provider';
const UNRECORDED_NOTE = 'the provider confirmed the refund but it could not be recorded as succeeded — confirm in the provider, then resolve';

const CATEGORY = 'campaign_billing' as const;
const SOURCE = 'package-refund';

type AdminClient = ReturnType<typeof createAdminClient>;

export type PackageRefundInput = {
  campaignId: string;
  eventId: string;
  // What goes back to the card, in shekels and whole agorot. The caller decides it (the admin, from the cancellation
  // terms); this module only refuses what the ledger says cannot be refunded.
  amount: number;
  cancellationRequestId: string;
};

export type PackageRefundRefusal =
  | 'disabled' // a gate is closed (payments off, provider not configured)
  | 'invalid_amount'
  | 'no_payment' // the campaign has no succeeded package payment, or nothing left on it
  | 'exceeds_refundable'
  | 'no_customer' // the payer has no SUMIT customer number: a credit must never open a second customer
  | 'no_card'; // no saved card / expiry / holder id: the admin refunds by hand

export type PackageRefundResult =
  | { status: 'refunded'; amount: number; document: ProviderDocument | null; alreadyDone: boolean }
  | { status: 'declined' } // a clear refusal; nothing went back; may be tried again
  | { status: 'review' } // unclear; the money may have gone back; a person decides; never retried automatically
  | { status: 'in_progress' } // another attempt of the same request is running
  | { status: 'refused'; reason: PackageRefundRefusal } // checked BEFORE anything was written or sent
  | { status: 'error' }; // something failed BEFORE anything was sent

const toCents = (n: number) => Math.round(n * 100);
const isMoney = (n: number) => Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const refused = (reason: PackageRefundRefusal): PackageRefundResult => ({ status: 'refused', reason });

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
    console.error('[package-refund] could not close the refund row; the orphan sweeper will move it to review', {
      campaignId,
      operationId,
      wanted: result.outcome,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

type SavedCard = NonNullable<Awaited<ReturnType<typeof currentCard>>>;

// Everything a refund needs, read WITHOUT writing or sending anything. Either the pieces, or the answer that stops it.
// Shared by checkPackageRefund (the look before the promise) and refundPackagePayment (the refund itself), so the two
// can never disagree about whether a refund may go ahead.
type Prepared =
  | {
      ok: true;
      admin: AdminClient;
      sumit: { companyId: number; apiKey: string };
      parentOperationId: string;
      customerId: number;
      card: SavedCard;
      citizenId: string;
    }
  | { ok: false; result: PackageRefundResult };

async function prepare(input: PackageRefundInput): Promise<Prepared> {
  const { campaignId, amount, cancellationRequestId } = input;
  const stop = (result: PackageRefundResult): Prepared => ({ ok: false, result });
  if (!isMoney(amount)) return stop(refused('invalid_amount'));

  // 1. Gates. Each reader resolves to "off / not configured" on any error.
  const [paymentsOn, sumit] = await Promise.all([getPaymentsEnabled(), getSumitServerConfig()]);
  if (!paymentsOn) return stop(refused('disabled'));
  if (!sumit) {
    console.error('[package-refund] enabled but the provider configuration is missing', { campaignId });
    return stop(refused('disabled'));
  }

  const admin = createAdminClient();
  // 2-4. Any failure while reading means nothing was written and nothing was sent.
  try {
    // A request that already refunded must not refund again, and one still in flight must not start over.
    const earlier = await refundsOfRequest(admin, campaignId, cancellationRequestId);
    const done = earlier.find((op) => op.outcome === 'succeeded');
    if (done) return stop({ status: 'refunded', amount: done.amount, document: done.document, alreadyDone: true });
    if (earlier.some((op) => op.outcome === 'review')) return stop({ status: 'review' });
    if (earlier.some((op) => op.outcome === 'pending')) return stop({ status: 'in_progress' });

    const purchase = await latestOperation(admin, campaignId, 'package_purchase', 'succeeded');
    const refundable = refundableAmount(await loadOperations(admin, campaignId));
    if (!purchase || refundable <= 0) return stop(refused('no_payment'));
    if (toCents(amount) > toCents(refundable)) return stop(refused('exceeds_refundable'));

    // The credit goes on the SAME SUMIT customer as the payment, or it would open a second one.
    const payer = (await getOperation(admin, purchase.id))?.meta.payerUserId;
    const customerId = typeof payer === 'string' ? await getSumitCustomerId(payer) : null;
    if (!customerId) return stop(refused('no_customer'));

    const card = await currentCard(admin, campaignId);
    const citizenId = card ? await readCitizenId(admin, card.operationId) : null;
    if (!card || !card.expMonth || !card.expYear || !citizenId) return stop(refused('no_card'));

    return { ok: true, admin, sumit, parentOperationId: purchase.id, customerId, card, citizenId };
  } catch {
    console.error('[package-refund] could not read what is refundable; nothing was sent', { campaignId });
    return stop({ status: 'error' });
  }
}

// The look before the promise: null when refundPackagePayment would go ahead, otherwise the answer it would give.
// Reads only. The cancellation resolution sends the customer an e-mail before any money moves, so it asks first.
export async function checkPackageRefund(input: PackageRefundInput): Promise<PackageRefundResult | null> {
  const prepared = await prepare(input);
  return prepared.ok ? null : prepared.result;
}

// What a screen and the cancellation resolution need to know about a package campaign's money. THROWS when the ledger
// cannot be read: "nothing to refund" must never be the display of a failed read.
export async function packageRefundSummary(
  campaignId: string,
  cancellationRequestId?: string,
): Promise<{ refundable: number; refundedForRequest: number; hasCard: boolean }> {
  const admin = createAdminClient();
  const [ops, card, earlier] = await Promise.all([
    loadOperations(admin, campaignId),
    currentCard(admin, campaignId),
    cancellationRequestId ? refundsOfRequest(admin, campaignId, cancellationRequestId) : Promise.resolve([]),
  ]);
  const refundedCents = earlier.filter((op) => op.outcome === 'succeeded').reduce((sum, op) => sum + toCents(op.amount), 0);
  return {
    refundable: refundableAmount(ops),
    refundedForRequest: refundedCents / 100,
    // A card is usable when the saved row carries the expiry and the id of the vault secret that holds the holder id.
    hasCard: !!(card && card.expMonth && card.expYear && card.citizenSecretId),
  };
}

export async function refundPackagePayment(input: PackageRefundInput): Promise<PackageRefundResult> {
  const { campaignId, eventId, amount, cancellationRequestId } = input;
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared.result;
  const { admin, sumit, parentOperationId, customerId, card, citizenId } = prepared;

  // The PENDING row, before SUMIT is asked for anything. The line is what prints on the credit document.
  let operationId: string;
  try {
    const begun = await beginOperation(admin, {
      campaignId,
      eventId,
      kind: 'refund',
      amount,
      parentOperationId,
      meta: { cancellation_request_id: cancellationRequestId },
      lines: [{ description: REFUND_LINE, unitPrice: amount }],
    });
    if ('alreadyInProgress' in begun) return { status: 'in_progress' };
    operationId = begun.id;
  } catch {
    console.error('[package-refund] could not take the refund lock; nothing was sent', { campaignId });
    return { status: 'error' };
  }

  // The limit again, now that the row is held: a refund of another request may have been recorded between the first
  // check and the row. Our own pending row is already counted, so a negative sum means we would overdraw.
  try {
    if (refundableCents(await loadOperations(admin, campaignId)) < 0) {
      await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: UNLOCKED_NOTE });
      return refused('exceeds_refundable');
    }
  } catch {
    console.error('[package-refund] could not re-check the refundable amount; the row is left for the sweeper', { campaignId, operationId });
    return { status: 'error' };
  }

  // The credit.
  let answer: Awaited<ReturnType<typeof billingPaymentsCharge>>;
  try {
    answer = await billingPaymentsCharge(
      {
        Customer: { ID: customerId },
        PaymentMethod: {
          CreditCard_Token: card.tokenRef,
          CreditCard_ExpirationMonth: card.expMonth,
          CreditCard_ExpirationYear: card.expYear,
          CreditCard_CitizenID: citizenId,
          Type: OfficeGuyAppsBillingMVCAPITypedPaymentMethodType.CreditCard,
        },
        // A credit instead of a charge when the total is negative (proven live 6.10.2026), on the card the payment used.
        SupportCredit: true,
        Items: [{ Quantity: 1, UnitPrice: -amount, Item: { Name: REFUND_LINE }, Description: REFUND_LINE }],
        AutoCapture: true,
        PreventDocumentCreation: false,
        // The document is sent in a separate, best-effort step below, by its id.
        SendDocumentByEmail: false,
        DraftDocument: false,
      },
      { sumit: { creds: { companyId: sumit.companyId, apiKey: sumit.apiKey }, timeoutMs: 60_000 } },
    );
  } catch (err) {
    // SUMIT itself refused and nothing happened: a clear decline. Everything else — the network, a timeout, a body we
    // could not read, an error we did not expect — is "we do not know": the money may already be back.
    if (err instanceof SumitError && !err.outcomeUnknown) {
      console.error('[package-refund] declined', { campaignId, operationId, kind: err.kind });
      await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: DECLINED_NOTE });
      void sendSlackAlert({
        level: 'warn',
        category: CATEGORY,
        source: SOURCE,
        title: 'זיכוי ללקוח חבילה נדחה',
        fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId },
      });
      return { status: 'declined' };
    }
    console.error('[package-refund] ambiguous outcome', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: UNCLEAR_NOTE });
    void sendSlackAlert({
      level: 'error',
      category: CATEGORY,
      source: SOURCE,
      title: 'זיכוי ללקוח חבילה בבדיקה ידנית — התשובה מחברת האשראי לא חד-משמעית',
      fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId },
    });
    return { status: 'review' };
  }

  // SUMIT said Status 0. That is not yet "the money is back": the payment must be valid, it must be a CREDIT of exactly
  // the amount we asked for, and a document must exist. A refusal by the issuer comes inside a 200 as ValidPayment false.
  const data = answer.Data;
  const payment = data?.Payment;
  if (payment?.ValidPayment === false) {
    console.error('[package-refund] declined by the issuer', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: DECLINED_NOTE });
    void sendSlackAlert({
      level: 'warn',
      category: CATEGORY,
      source: SOURCE,
      title: 'זיכוי ללקוח חבילה נדחה',
      fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId },
    });
    return { status: 'declined' };
  }
  const document: ProviderDocument = {
    id: data?.DocumentID ?? null,
    number: data?.DocumentNumber ?? null,
    url: data?.DocumentDownloadURL ?? null,
  };
  const looksLikeOurCredit =
    payment?.ValidPayment === true &&
    document.id != null &&
    typeof payment.Amount === 'number' &&
    toCents(payment.Amount) === -toCents(amount);
  const providerRefs = {
    providerPaymentId: payment?.ID ?? null,
    providerAuthRef: payment?.AuthNumber ?? null,
    providerStatus: payment?.Status ?? null,
    providerStatusDescription: payment?.StatusDescription ?? null,
    providerDocument: document,
  };
  if (!looksLikeOurCredit) {
    console.error('[package-refund] the answer does not look like the credit that was asked for', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: UNCLEAR_NOTE, ...providerRefs });
    void sendSlackAlert({
      level: 'error',
      category: CATEGORY,
      source: SOURCE,
      title: 'זיכוי ללקוח חבילה בבדיקה ידנית — התשובה מחברת האשראי אינה תואמת את הבקשה',
      fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId, document_number: document.number ?? 'none' },
    });
    return { status: 'review' };
  }

  // The credit is confirmed. Record it; from here nothing may undo it.
  try {
    await completeOperation(admin, operationId, { from: 'pending', outcome: 'succeeded', amount, ...providerRefs });
  } catch (err) {
    console.error('[package-refund] CONFIRMED refund could not be recorded — manual reconciliation required', {
      campaignId,
      operationId,
      documentNumber: document.number,
      paymentId: payment?.ID ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: UNRECORDED_NOTE, ...providerRefs });
    void sendSlackAlert({
      level: 'error',
      category: CATEGORY,
      source: SOURCE,
      title: 'זיכוי ללקוח חבילה אושר בסאמיט אך לא נשמר — נדרשת התאמה ידנית',
      fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId, document_number: document.number ?? 'none' },
    });
    return { status: 'review' };
  }

  // Follow-ups, each best-effort: the refund is recorded and must not be affected by any of them.
  try {
    await accountingDocumentsSend({ EntityID: document.id }, { sumit: { creds: { companyId: sumit.companyId, apiKey: sumit.apiKey } } });
  } catch {
    console.error('[package-refund] the credit document could not be sent to the customer (non-fatal)', { campaignId, operationId });
    void sendSlackAlert({
      level: 'warn',
      category: CATEGORY,
      source: SOURCE,
      title: 'תעודת הזיכוי לא נשלחה ללקוח במייל — יש לשלוח אותה ידנית מ-SUMIT',
      fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId, document_number: document.number ?? 'none' },
    });
  }
  try {
    await logActivity({
      eventId,
      action: 'campaign.package_refunded',
      meta: { campaignId, operationId, amount, documentNumber: document.number },
    });
  } catch {
    console.error('[package-refund] logActivity failed (non-fatal)', { campaignId });
  }
  void sendSlackAlert({
    level: 'info',
    category: CATEGORY,
    source: SOURCE,
    title: 'הוחזר כסף ללקוח חבילה',
    fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId, document_number: document.number ?? 'none' },
  });

  return { status: 'refunded', amount, document, alreadyDone: false };
}
