import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { cancelableDocument } from '@/lib/cardcom/document-types';
import { documentsCancelDoc } from '@/lib/cardcom/generated/documents/documents';
import { CardcomError } from '@/lib/cardcom/mutator';
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
// WHAT IS DIFFERENT FROM SUMIT. The mechanism is Documents/CancelDoc: it cancels the payment's document and returns the card
// payment WHOLE. So:
//   - only a FULL refund is built. A partial one (a cancellation fee stays with us) is refused as `partial_unsupported`; it
//     waits for plan item U9 (CardCom's Transactions/RefundByTransactionId returns no document, and which credit document a
//     partial refund produces is not yet known);
//   - what is cancelled is identified by the document NUMBER and TYPE the payment issued (kept on its ledger row), and the
//     document CardCom answers with must be the refund counterpart of it (cardcom/document-types.ts) — otherwise the refund is
//     not believed;
//   - CancelDoc sends no terminal: it names the company only by the API name and password of the CURRENT connection. A payment made
//     on another terminal than the connection uses now - or on one that was never recorded - is refused as `terminal_changed` before
//     anything is written or sent, and is refunded by hand;
//   - it needs no saved card and no customer number: the API password (a vault secret) is the only credential;
//   - a refund goes back through the company that was PAID, so it needs the connection to exist but not the pilot switch.
// Never logs the API password. Never puts CardCom's own text in front of an admin except through the ledger row.

const REFUND_LINE = 'KALFA — זיכוי ביטול חבילת אישורי הגעה לאירוע';
const CANCEL_TIMEOUT_MS = 30_000;
const CATEGORY = 'campaign_billing' as const;
const SOURCE = 'cardcom-refund';

const DECLINED_NOTE = 'CardCom refused the cancellation; nothing was returned';
const UNCLEAR_NOTE = 'the answer from CardCom was unclear; the money may have been returned — check CardCom before any retry';
const MISMATCH_NOTE = 'CardCom answered success, but not with the refund document we expected — check CardCom before any retry';
const UNLOCKED_NOTE = 'more than the card paid would have been returned; nothing was sent to CardCom';
const UNRECORDED_NOTE = 'CardCom confirmed the refund but it could not be recorded as succeeded — confirm in CardCom, then resolve';

type AdminClient = ReturnType<typeof createAdminClient>;

const toCents = (n: number) => Math.round(n * 100);
const isMoney = (n: number) => Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const refused = (reason: PackageRefundRefusal): PackageRefundResult => ({ status: 'refused', reason });
const asMeta = (meta: Json | undefined): { [key: string]: Json | undefined } =>
  meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};

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
  id: string; amount: number | string; provider_document_number: number | null; meta: Json;
  // The terminal the payment was opened on (null = a row from before the stamp existed) and the class the database gave it.
  provider_terminal: number | null; is_test: boolean;
};
async function succeededPurchase(admin: AdminClient, campaignId: string): Promise<PurchaseRow | null> {
  const { data, error } = await admin
    .from('payment_operations')
    .select('id, amount, provider_document_number, meta, provider_terminal, is_test')
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

// The document that can be cancelled for a payment, or null when there is none we can name.
function documentOf(purchase: PurchaseRow): { number: number; type: number; refundType: number } | null {
  const number = purchase.provider_document_number;
  const known = cancelableDocument(asMeta(purchase.meta).cardcom_document_type);
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0 || !known) return null;
  return { number, type: known.type, refundType: known.refundType };
}

type Prepared =
  | { ok: true; admin: AdminClient; terminalApiName: string; password: string; purchase: PurchaseRow; document: { number: number; type: number; refundType: number } }
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

    // CancelDoc cancels the document, and with it the whole card payment: only a refund of everything the card paid, with
    // nothing refunded before, is a refund it can make.
    const paid = toCents(Number(purchase.amount));
    if (toCents(amount) !== paid || toCents(refundable) !== paid) return stop(refused('partial_unsupported'));

    const document = documentOf(purchase);
    if (!document) return stop(refused('no_document'));

    return { ok: true, admin, terminalApiName: config.apiName, password, purchase, document };
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
// read. `hasCard` keeps its name for the callers it is shared with: for CardCom it means "a document exists that can be refunded".
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
  // (another terminal, or none recorded) reads as "no card", which sends the admin to refund by hand.
  const hasCard = !!purchase && !!config && documentOf(purchase) !== null && refundableOnThisConnection(purchase, config.terminalNumber);
  // The refund's credit document: CancelDoc answers only its number and type (no id, no link), and the ledger row keeps it.
  return { refundable: refundableAmount(ops), refundedForRequest: refundedCents / 100, hasCard, refundDocument: succeeded[0]?.document ?? null };
}

export async function refundCardcomPayment(input: PackageRefundInput): Promise<PackageRefundResult> {
  const { campaignId, eventId, amount, cancellationRequestId } = input;
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared.result;
  const { admin, terminalApiName, password, purchase, document } = prepared;

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

  // The cancellation.
  let answer: Awaited<ReturnType<typeof documentsCancelDoc>>;
  try {
    answer = await documentsCancelDoc(
      { ApiName: terminalApiName, ApiPassword: password, DocumentNumber: document.number, DocumentType: document.type },
      { cardcom: { timeoutMs: CANCEL_TIMEOUT_MS } },
    );
  } catch (err) {
    // CardCom itself refused the request (a 4xx) and nothing happened: a clear refusal. Everything else — the network, a
    // timeout, a 5xx, a body we could not read — is "we do not know": the money may already be back.
    if (err instanceof CardcomError && !err.outcomeUnknown) {
      console.error('[cardcom-refund] refused', { campaignId, operationId, kind: err.kind });
      await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'failed', note: DECLINED_NOTE });
      alert('warn', 'זיכוי ללקוח חבילה ב-CardCom נדחה');
      return { status: 'declined' };
    }
    console.error('[cardcom-refund] ambiguous outcome', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: UNCLEAR_NOTE });
    alert('error', 'זיכוי ללקוח חבילה ב-CardCom בבדיקה ידנית — התשובה לא חד-משמעית');
    return { status: 'review' };
  }

  // CardCom's guide: a refund answers ResponseCode 0 with the NEW document. A non-zero code is a refusal.
  if (answer.ResponseCode !== 0) {
    console.error('[cardcom-refund] CardCom did not cancel the document', { campaignId, operationId });
    await settle(admin, operationId, campaignId, {
      from: 'pending', outcome: 'failed', note: DECLINED_NOTE,
      providerStatus: String(answer.ResponseCode ?? 'none'), providerStatusDescription: answer.Description ?? null,
    });
    alert('warn', 'זיכוי ללקוח חבילה ב-CardCom נדחה');
    return { status: 'declined' };
  }

  // ResponseCode 0 is not yet "the money is back for THIS payment": the new document must exist and be the refund of the type
  // we asked to cancel. A different one means the type numbers are wrong (cardcom/document-types.ts) — not believed.
  const newDocument: ProviderDocument | null = typeof answer.NewDocumentNumber === 'number' ? { id: null, number: answer.NewDocumentNumber, url: null } : null;
  const refs = { providerStatus: '0', providerStatusDescription: answer.Description ?? null, providerDocument: newDocument };
  if (!newDocument || answer.NewDocumentType !== document.refundType) {
    console.error('[cardcom-refund] the answer does not look like the refund that was asked for', { campaignId, operationId });
    await settle(admin, operationId, campaignId, { from: 'pending', outcome: 'review', note: MISMATCH_NOTE, ...refs });
    alert('error', 'זיכוי ללקוח חבילה ב-CardCom בבדיקה ידנית — המסמך שהוחזר אינו תואם לבקשה', { document_number: newDocument?.number ?? 'none' });
    return { status: 'review' };
  }

  // The refund is confirmed. Record it; from here nothing may undo it.
  try {
    await completeOperation(admin, operationId, { from: 'pending', outcome: 'succeeded', amount, ...refs });
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
