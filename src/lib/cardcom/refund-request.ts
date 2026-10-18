import type { CreateDocumentRequest, RefundByTransactionIdReq } from './generated/models';
import type { RefundDocument } from './document-types';

// Builds the two requests that give a package payment back (openspec/changes/refund-cardcom-by-transaction-id). Pure: they read
// nothing and send nothing, so every rule can be pinned by a test.
//
// 1. The money: Transactions/RefundByTransactionId (owner, 18.10.2026). It refunds THE payment's own CardCom transaction, by its id, so
//    the refund is linked to the payment. Transactions/Transaction with Advanced.IsRefund, used before, charged a new credit
//    transaction to the card's token and issued a credit document linked to neither.
// 2. The credit document: Documents/CreateDocument, linked to the REFUND deal through DealNumbers (CardCom's OpenAPI: DealNumbers,
//    items { DealNumber }). The operation in 1 issues none: the first real refund (18.10.2026 21:05) carried the `Document` object
//    CardCom's support had named for it, and CardCom issued no document (its answer had none, and the owner found none).
//
// The rules of 1:
//   - TransactionId is the payment's CardCom transaction id, kept on its ledger row (provider_payment_id); ApiPassword is required;
//   - PartialSum only when less than the payment goes back: without it CardCom refunds the whole transaction, which is then the amount;
//   - AllowMultipleRefunds only when an earlier refund of the same payment exists, so CardCom accepts another one;
//   - ExternalRefundDealId is our refund row's id, to find the refund in CardCom's reports. CardCom documents no deduplication by it,
//     and nothing here relies on one: an unclear refund is never sent again (cardcom-refund.ts).
// The rules of 2:
//   - the type is the credit counterpart of the payment's document (document-types.ts); it is to the cardholder CardCom recorded on
//     the payment, with one line for the amount that went back, in shekels;
//   - DealNumbers names the refund's own transaction (RefundByTransactionId's NewTranzactionId), not the original charge.

export type CardcomRefundInput = {
  apiName: string;
  apiPassword: string;
  /** Our pending ledger row for this refund. */
  operationId: string;
  /** The payment's CardCom transaction id. */
  transactionId: number;
  amount: number;
  /** What the payment took, to tell a partial refund from a whole one. */
  paidAmount: number;
  /** An earlier refund of the same payment exists (succeeded, or one whose outcome is not known). */
  earlierRefund: boolean;
};

export type CardcomCreditDocumentInput = {
  apiName: string;
  apiPassword: string;
  /** The refund's own CardCom transaction (RefundByTransactionId's NewTranzactionId). */
  refundTransactionId: number;
  amount: number;
  document: RefundDocument;
  /** Who the credit document is to: the cardholder CardCom recorded on the payment. */
  holder: { name: string; email: string | null };
  /** The one line on the credit document. */
  line: string;
};

const toCents = (n: number) => Math.round(n * 100);
const hasMoreDecimals = (n: number, places: number) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) > 1e-6;
const isMoney = (n: number) => Number.isFinite(n) && n > 0 && !hasMoreDecimals(n, 2);
const isId = (n: number) => Number.isInteger(n) && n > 0;

export function buildRefundByTransactionId(input: CardcomRefundInput): RefundByTransactionIdReq {
  const apiName = input.apiName.trim();
  if (
    apiName === '' || input.apiPassword === '' || !isId(input.transactionId) ||
    !isMoney(input.amount) || !isMoney(input.paidAmount) || toCents(input.amount) > toCents(input.paidAmount)
  ) {
    throw new Error('בקשת זיכוי ל-CardCom אינה תקינה');
  }
  const partial = toCents(input.amount) < toCents(input.paidAmount);
  return {
    ApiName: apiName,
    ApiPassword: input.apiPassword,
    TransactionId: input.transactionId,
    ExternalRefundDealId: input.operationId,
    ...(partial ? { PartialSum: input.amount } : {}),
    ...(input.earlierRefund ? { AllowMultipleRefunds: true } : {}),
  };
}

export function buildCreditDocument(input: CardcomCreditDocumentInput): CreateDocumentRequest {
  const apiName = input.apiName.trim();
  const name = input.holder.name.trim().slice(0, 50);
  if (apiName === '' || input.apiPassword === '' || name === '' || input.line.trim() === '' || !isId(input.refundTransactionId) || !isMoney(input.amount)) {
    throw new Error('בקשת מסמך זיכוי ל-CardCom אינה תקינה');
  }
  const email = input.holder.email?.trim();
  return {
    ApiName: apiName,
    ApiPassword: input.apiPassword,
    Document: {
      DocumentTypeToCreate: input.document.create,
      Name: name,
      ...(email ? { Email: email.slice(0, 50) } : {}),
      Languge: 'he',
      ISOCoinID: 1,
      Products: [{ Description: input.line, Quantity: 1, UnitCost: input.amount }],
    },
    DealNumbers: [{ DealNumber: input.refundTransactionId }],
  };
}
