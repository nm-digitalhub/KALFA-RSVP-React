import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { refundDocumentFor, type RefundDocument } from '@/lib/cardcom/document-types';
import { transactionsTransaction } from '@/lib/cardcom/generated/transactions/transactions';
import { CardcomError, cardcomFailureFacts } from '@/lib/cardcom/mutator';
import { buildRefundTransaction, expiryMMYY } from '@/lib/cardcom/refund-request';
import { cardFactsFromCardcom, documentUrlFromCardcom, occurredAtFromCardcom } from './cardcom-card-facts';
import { paymentFactsFromCardcom } from './cardcom-payment-facts';
import { terminalEchoFromCardcom } from './cardcom-terminal-echo';
import { logActivity } from '@/lib/data/activity';
import { getCardcomApiPassword, getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { getPaymentsEnabled } from '@/lib/data/payments';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

import { beginOperation, completeOperation, loadOperations, refundsOfRequest, type ProviderDocument } from './ledger';
import type { PackageRefundInput, PackageRefundRefusal, PackageRefundResult, PackageRefundSummary } from './package-refund-types';
import { refundableAmount, refundableCents } from './status';
import { labelTestMoney } from './test-money-label';

// Giving a customer's money back for a package paid through CardCom (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// 4.8). The counterpart of package-refund.ts (SUMIT), with the same safety argument in the same order:
//   1. every gate is fail-closed (payments on, CardCom configured, the API password stored);
//   2. the amount is checked against the LEDGER — what the card actually paid minus what already went back, refunds still
//      pending or in review counted as gone — never against anything the admin or the browser typed;
//   3. a refund of one cancellation request is made ONCE: an earlier succeeded refund of the same request is returned as it
//      is, and one still pending or in review stops this attempt before it starts (the database backs this up);
//   4. the PENDING ledger row is written BEFORE CardCom is asked to move any money, and the limit is checked AGAIN once the
//      row is held;
//   5. a clear refusal closes the row as failed and may be tried again. Anything else — the network, a timeout, an answer that
//      does not look like the refund we asked for — goes to REVIEW and is never retried by this code: the money may be back;
//   6. once CardCom confirmed, nothing that comes after can undo it.
//
// WHAT IS DIFFERENT FROM SUMIT. The mechanism is Transactions/Transaction ("Do Transaction") with Advanced.IsRefund and a
// Document object: one call gives the money back to the payment's card TOKEN and issues the credit document (owner's choice,
// 9.10.2026 — Documents/CancelDoc answered 9006 "no permission", and RefundByTransactionId issues no document). So:
//   - any amount up to what is refundable goes back — a full refund or a partial one (a cancellation fee stays with us);
//   - it needs the token, its expiry and the cardholder's name CardCom recorded on the payment's ledger row; a payment without
//     them is refused as `no_card` (refunded by hand);
//   - the credit document is the counterpart of the payment's own document (cardcom/document-types.ts); a payment whose document
//     type is not one of the two a package produces is refused as `no_document`. The answer must be a refund that created THAT
//     document type — otherwise it is not believed (review);
//   - the request names the terminal; a payment made on another terminal than the connection uses now — or on one never
//     recorded — is refused as `terminal_changed` before anything is written or sent: its token belongs to that terminal;
//   - our pending row's id is CardCom's ExternalUniqTranId, so CardCom itself never moves money twice for one row;
//   - a refund goes back through the company that was PAID, so it needs the connection to exist but not the pilot switch.
// Never logs the API password or the token. Never puts CardCom's own text in front of an admin except through the ledger row.

const REFUND_LINE = 'KALFA — זיכוי ביטול חבילת אישורי הגעה לאירוע';
const REFUND_TIMEOUT_MS = 30_000;
const CATEGORY = 'campaign_billing' as const;
const SOURCE = 'cardcom-refund';

const DECLINED_NOTE = 'CardCom refused the refund; nothing was returned';
const UNCLEAR_NOTE = 'the answer from CardCom was unclear; the money may have been returned — check CardCom before any retry';
const MISMATCH_NOTE = 'CardCom answered success, but not as the refund with the credit document we asked for — check CardCom before any retry';
const INVALID_REQUEST_NOTE = 'the refund request could not be built from the payment row; nothing was sent to CardCom';
const UNLOCKED_NOTE = 'more than the card paid would have been returned; nothing was sent to CardCom';
const UNRECORDED_NOTE = 'CardCom confirmed the refund but it could not be recorded as succeeded — confirm in CardCom, then resolve';

type AdminClient = ReturnType<typeof createAdminClient>;

const toCents = (n: number) => Math.round(n * 100);
const isMoney = (n: number) => Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const refused = (reason: PackageRefundRefusal): PackageRefundResult => ({ status: 'refused', reason });
const asMeta = (meta: Json | undefined): { [key: string]: Json | undefined } =>
  meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort completion of a row whose outcome is already certain from CardCom's side. A failure here is loud, not fatal: the
// row stays pending and the orphan sweeper moves it to review within ten minutes.
async function settle(admin: AdminClient, operationId: string, campaignId: string, result: Parameters<typeof completeOperation>[2]): Promise<boolean> {
  try {
    await completeOperation(admin, operationId, result);
    return true;
  } catch (err) {
    console.error('[cardcom-refund] could not close the refund row; the orphan sweeper will move it to review', {
      campaignId, operationId, wanted: result.outcome, error: err instanceof Error ? err.name : typeof err,
    });
    return false;
  }
}

type PurchaseRow = {
  id: string; amount: number | string; meta: Json;
  // The terminal the payment was opened on (null = a row from before the stamp existed) and the class the database gave it.
  provider_terminal: number | null; is_test: boolean;
  // What a token refund needs, as CardCom recorded it on the payment. The token is read only here and passed only to the request.
  card_token_ref: string | null; card_exp_month: number | null; card_exp_year: number | null;
  card_owner_name: string | null; card_owner_email: string | null;
  // The Vault secret holding the cardholder's ID, kept by the purchase: the refund row points at the same one (the refund is to
  // the same card and holder) instead of storing the ID a second time.
  citizen_id_secret: string | null;
};
async function succeededPurchase(admin: AdminClient, campaignId: string): Promise<PurchaseRow | null> {
  const { data, error } = await admin
    .from('payment_operations')
    .select('id, amount, meta, provider_terminal, is_test, card_token_ref, card_exp_month, card_exp_year, card_owner_name, card_owner_email, citizen_id_secret')
    .eq('campaign_id', campaignId)
    .eq('kind', 'package_purchase')
    .eq('outcome', 'succeeded')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('טעינת פעולות התשלום נכשלה');
  // Normalised: a row that says nothing is "no recorded terminal" and real money.
  return data ? { ...data, provider_terminal: typeof data.provider_terminal === 'number' ? data.provider_terminal : null, is_test: data.is_test === true } : null;
}

// Can the CURRENT connection refund this payment? Only when the payment was opened on the terminal the connection uses now: the
// refund names the company by the connection's credentials alone. A payment with no recorded terminal cannot be vouched for.
const refundableOnThisConnection = (purchase: PurchaseRow, terminalNumber: number): boolean => purchase.provider_terminal === terminalNumber;

// The credit document a refund of this payment issues, or null when the payment's document type is not one we can name.
const creditDocumentOf = (purchase: PurchaseRow): RefundDocument | null => refundDocumentFor(asMeta(purchase.meta).cardcom_document_type);

// The card the money goes back to: the payment's token, its expiry and the cardholder's name — or null when any is missing.
type RefundCard = { token: string; expMonth: number; expYear: number; holderName: string; holderEmail: string | null };
function cardOf(purchase: PurchaseRow): RefundCard | null {
  const { card_token_ref: token, card_exp_month: expMonth, card_exp_year: expYear } = purchase;
  const holderName = purchase.card_owner_name?.trim() ?? '';
  if (typeof token !== 'string' || !GUID.test(token) || expMonth == null || expYear == null || !expiryMMYY(expMonth, expYear) || holderName === '') {
    return null;
  }
  return { token, expMonth, expYear, holderName, holderEmail: purchase.card_owner_email };
}

type Prepared =
  | {
      ok: true; admin: AdminClient; terminalNumber: number; terminalApiName: string; password: string; purchase: PurchaseRow;
      card: RefundCard; document: RefundDocument;
    }
  | { ok: false; result: PackageRefundResult };

// Everything a refund needs, read WITHOUT writing or sending anything. Either the pieces, or the answer that stops it. Shared by
// checkCardcomRefund (the look before the promise) and refundCardcomPayment (the refund itself), so the two cannot disagree.
async function prepare(input: PackageRefundInput): Promise<Prepared> {
  const { campaignId, amount, cancellationRequestId } = input;
  const stop = (result: PackageRefundResult): Prepared => ({ ok: false, result });
  if (!isMoney(amount)) return stop(refused('invalid_amount'));

  // 1. Gates. The connection must exist and the password be stored; the pilot SWITCH is not needed to refund what it took.
  const [paymentsOn, config, password] = await Promise.all([getPaymentsEnabled(), getCardcomServerConfig(), getCardcomApiPassword()]);
  if (!paymentsOn || !config || !password) {
    console.error('[cardcom-refund] payments are off or the CardCom connection is incomplete; nothing was sent', { campaignId });
    return stop(refused('disabled'));
  }

  const admin = createAdminClient();
  try {
    // A request that already refunded must not refund again, and one still in flight must not start over.
    const earlier = await refundsOfRequest(admin, campaignId, cancellationRequestId);
    const done = earlier.find((op) => op.outcome === 'succeeded');
    if (done) return stop({ status: 'refunded', amount: done.amount, document: done.document, alreadyDone: true });
    if (earlier.some((op) => op.outcome === 'review')) return stop({ status: 'review' });
    if (earlier.some((op) => op.outcome === 'pending')) return stop({ status: 'in_progress' });

    const purchase = await succeededPurchase(admin, campaignId);
    const refundable = refundableAmount(await loadOperations(admin, campaignId));
    if (!purchase || refundable <= 0) return stop(refused('no_payment'));
    if (toCents(amount) > toCents(refundable)) return stop(refused('exceeds_refundable'));
    // Before anything else that says "this could be done": if the connection cannot refund this payment at all, say so.
    if (!refundableOnThisConnection(purchase, config.terminalNumber)) return stop(refused('terminal_changed'));

    // The money goes back to the payment's token, and the credit document must be one we can name.
    const card = cardOf(purchase);
    if (!card) return stop(refused('no_card'));
    const document = creditDocumentOf(purchase);
    if (!document) return stop(refused('no_document'));

    return { ok: true, admin, terminalNumber: config.terminalNumber, terminalApiName: config.apiName, password, purchase, card, document };
  } catch {
    console.error('[cardcom-refund] could not read what is refundable; nothing was sent', { campaignId });
    return stop({ status: 'error' });
  }
}

// The look before the promise: null when refundCardcomPayment would go ahead, otherwise the answer it would give. Reads only.
export async function checkCardcomRefund(input: PackageRefundInput): Promise<PackageRefundResult | null> {
  const prepared = await prepare(input);
  return prepared.ok ? null : prepared.result;
}

// What a screen and the cancellation resolution need to know about a CardCom package's money. THROWS when the ledger cannot be
// read. `hasCard` means "refundCardcomPayment can give this payment back by itself": a token, a credit document we can name,
// and the terminal the connection uses now.
export async function cardcomRefundSummary(
  campaignId: string,
  cancellationRequestId?: string,
): Promise<PackageRefundSummary> {
  const admin = createAdminClient();
  const [ops, purchase, earlier, config] = await Promise.all([
    loadOperations(admin, campaignId),
    succeededPurchase(admin, campaignId),
    cancellationRequestId ? refundsOfRequest(admin, campaignId, cancellationRequestId) : Promise.resolve([]),
    getCardcomServerConfig(),
  ]);
  const succeeded = earlier.filter((op) => op.outcome === 'succeeded');
  const refundedCents = succeeded.reduce((sum, op) => sum + toCents(op.amount), 0);
  // The screen must not promise an automatic refund that refundCardcomPayment will refuse: a payment the connection cannot refund
  // (no token, a document we cannot name, another terminal or none recorded) reads as "no card", which sends the admin to refund
  // by hand.
  const hasCard =
    !!purchase && !!config && cardOf(purchase) !== null && creditDocumentOf(purchase) !== null &&
    refundableOnThisConnection(purchase, config.terminalNumber);
  // The refund's credit document, as the ledger row keeps it (its number and link, from CardCom's answer).
  return { refundable: refundableAmount(ops), refundedForRequest: refundedCents / 100, hasCard, refundDocument: succeeded[0]?.document ?? null };
}

export async function refundCardcomPayment(input: PackageRefundInput): Promise<PackageRefundResult> {
  const { campaignId, eventId, amount, cancellationRequestId } = input;
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared.result;
  const { admin, terminalNumber, terminalApiName, password, purchase, card, document } = prepared;

  // The PENDING row, before CardCom is asked for anything. The line is what the ledger shows the money as.
  let operationId: string;
  try {
    const begun = await beginOperation(admin, {
      campaignId,
      eventId,
      kind: 'refund',
      amount,
      parentOperationId: purchase.id,
      meta: { cancellation_request_id: cancellationRequestId, provider: 'cardcom' },
      lines: [{ description: REFUND_LINE, unitPrice: amount }],
    });
    if ('alreadyInProgress' in begun) return { status: 'in_progress' };
    operationId = begun.id;
  } catch {
    console.error('[cardcom-refund] could not take the refund lock; nothing was sent', { campaignId });
    return { status: 'error' };
  }

  // The limit again, now that the row is held: a refund of another request may have been recorded between the first check and
  // the row. Our own pending row is already counted, so a negative sum means we would overdraw.
  try {
    if (refundableCents(await loadOperations(admin, campaignId)) < 0) {
      await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: UNLOCKED_NOTE });
      return refused('exceeds_refundable');
    }
  } catch {
    console.error('[cardcom-refund] could not re-check the refundable amount; the row is left for the sweeper', { campaignId, operationId });
    return { status: 'error' };
  }

  // The refund of a TEST payment (the child takes its class from the parent) says so in every alert.
  const isTest = purchase.is_test;
  const alert = (level: 'error' | 'warn' | 'info', title: string, extra: Record<string, string | number> = {}) =>
    void sendSlackAlert({ level, category: CATEGORY, source: SOURCE, title: labelTestMoney(title, isTest), fields: { campaign_id: campaignId, event_id: eventId, operation_id: operationId, ...extra } });

  // The request, built before anything is sent: one that cannot be built (prepare already checked every piece, so this is a
  // bug) closes the row as failed — nothing reached CardCom.
  let request: ReturnType<typeof buildRefundTransaction>;
  try {
    request = buildRefundTransaction({
      terminalNumber, apiName: terminalApiName, apiPassword: password, operationId, amount,
      token: card.token, expMonth: card.expMonth, expYear: card.expYear, document,
      holder: { name: card.holderName, email: card.holderEmail }, line: REFUND_LINE,
    });
  } catch {
    console.error('[cardcom-refund] the refund request could not be built; nothing was sent', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: INVALID_REQUEST_NOTE });
    return { status: 'error' };
  }

  // The refund, with its credit document, in one call.
  let answer: Awaited<ReturnType<typeof transactionsTransaction>>;
  try {
    answer = await transactionsTransaction(request, { cardcom: { timeoutMs: REFUND_TIMEOUT_MS } });
  } catch (err) {
    // CardCom itself refused the request (a 4xx) and nothing happened: a clear refusal. Everything else — the network, a
    // timeout, a 5xx, a body we could not read — is "we do not know": the money may already be back. Either way what the
    // failure carries (the HTTP status, CardCom's ResponseCode and Description) is kept: in the row and the alert, and in
    // the log as numbers only — so a refusal says WHY (9.10.2026: two refusals whose reason was thrown away).
    const facts = cardcomFailureFacts(err);
    const http = facts.httpStatus !== null ? ` (HTTP ${facts.httpStatus})` : '';
    const reason = facts.responseCode !== null || facts.description !== null
      ? { providerStatus: String(facts.responseCode ?? 'none'), providerStatusDescription: facts.description }
      : {};
    const alertFacts = {
      ...(facts.httpStatus !== null ? { http_status: facts.httpStatus } : {}),
      ...(facts.responseCode !== null ? { response_code: facts.responseCode } : {}),
      ...(facts.description !== null ? { description: facts.description } : {}),
    };
    const logFacts = { httpStatus: facts.httpStatus, responseCode: facts.responseCode };
    if (err instanceof CardcomError && !err.outcomeUnknown) {
      console.error('[cardcom-refund] refused', { campaignId, operationId, kind: err.kind, ...logFacts });
      await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: DECLINED_NOTE + http, ...reason });
      alert('warn', 'זיכוי ללקוח חבילה ב-CardCom נדחה', alertFacts);
      return { status: 'declined' };
    }
    console.error('[cardcom-refund] ambiguous outcome', { campaignId, operationId, ...logFacts });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: UNCLEAR_NOTE + http, ...reason });
    alert('error', 'זיכוי ללקוח חבילה ב-CardCom בבדיקה ידנית — התשובה לא חד-משמעית', alertFacts);
    return { status: 'review' };
  }

  // ResponseCode 0 is success (700/701 are J2/J5 checks, never a refund); anything else is a refusal.
  if (answer.ResponseCode !== 0) {
    console.error('[cardcom-refund] CardCom did not make the refund', { campaignId, operationId, responseCode: answer.ResponseCode ?? null });
    await settle(admin, operationId, campaignId, {
      from: 'pending', outcome: 'failed', note: DECLINED_NOTE,
      providerStatus: String(answer.ResponseCode ?? 'none'), providerStatusDescription: answer.Description ?? null,
    });
    alert('warn', 'זיכוי ללקוח חבילה ב-CardCom נדחה');
    return { status: 'declined' };
  }

  // ResponseCode 0 is not yet "the money is back with its credit document": the answer must be a REFUND that created the
  // document type we asked for, with its number. Anything else is not believed.
  // The link carries an access code: kept only when it is plainly CardCom's own https address (documentUrlFromCardcom).
  const newDocument: ProviderDocument | null =
    typeof answer.DocumentNumber === 'number' ? { id: null, number: answer.DocumentNumber, url: documentUrlFromCardcom(answer.DocumentUrl) } : null;
  // The terminal CardCom names in its answer, kept whatever the outcome below (the same column the purchase's settle fills).
  const echo = terminalEchoFromCardcom(answer.TerminalNumber);
  // The type CardCom says it created goes in meta.cardcom_document_type, like the purchase's own (cardcom-settle.ts): the
  // ledger's generated column provider_document_type reads it from there, and the document report matches by it. meta is
  // REPLACED on completion, so the row's own keys are written again with it.
  const refs = {
    providerStatus: '0', providerStatusDescription: answer.Description ?? null, providerDocument: newDocument,
    providerPaymentId: typeof answer.TranzactionId === 'number' ? answer.TranzactionId : null,
    providerAuthRef: answer.ApprovalNumber ?? null,
    ...(echo === null ? {} : { providerTerminalEcho: echo }),
    meta: {
      cancellation_request_id: cancellationRequestId, provider: 'cardcom',
      ...(typeof answer.DocumentType === 'string' ? { cardcom_document_type: answer.DocumentType } : {}),
    },
  };
  if (!newDocument || answer.IsRefund !== true || answer.DocumentType !== document.answered) {
    console.error('[cardcom-refund] the answer does not look like the refund that was asked for', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: MISMATCH_NOTE, ...refs });
    alert('error', 'זיכוי ללקוח חבילה ב-CardCom בבדיקה ידנית — המסמך שהוחזר אינו תואם לבקשה', { document_number: newDocument?.number ?? 'none' });
    return { status: 'review' };
  }

  // The refund is confirmed. Record it — with everything else CardCom answered about it (owner 8.10.2026: nothing it returns
  // is dropped), through the same field-by-field mappers the purchase uses, so a field CardCom sends malformed becomes null
  // and never keeps a confirmed refund from being recorded. Those facts are not in `refs`: refs is what a parked review row keeps.
  const occurredAt = occurredAtFromCardcom(answer.CreateDate);
  try {
    await completeOperation(admin, operationId, {
      from: 'pending', outcome: 'succeeded', amount, ...refs,
      cardFacts: cardFactsFromCardcom(answer, purchase.citizen_id_secret),
      paymentFacts: paymentFactsFromCardcom(answer, null),
      ...(occurredAt === null ? {} : { occurredAt }),
    });
  } catch {
    console.error('[cardcom-refund] CONFIRMED refund could not be recorded — manual reconciliation required', {
      campaignId, operationId, documentNumber: newDocument.number,
    });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: UNRECORDED_NOTE, ...refs });
    alert('error', 'זיכוי ללקוח חבילה אושר ב-CardCom אך לא נשמר — נדרשת התאמה ידנית', { document_number: newDocument.number ?? 'none' });
    return { status: 'review' };
  }

  // Follow-ups, each best-effort: the refund is recorded and must not be affected by any of them.
  try {
    await logActivity({ eventId, action: 'campaign.package_refunded', meta: { campaignId, operationId, amount, documentNumber: newDocument.number, provider: 'cardcom', ...(isTest ? { testMoney: true } : {}) } });
  } catch {
    console.error('[cardcom-refund] logActivity failed (non-fatal)', { campaignId });
  }
  alert('info', 'הוחזר כסף ללקוח חבילה (CardCom)', { document_number: newDocument.number ?? 'none' });
  return { status: 'refunded', amount, document: newDocument, alreadyDone: false };
}
