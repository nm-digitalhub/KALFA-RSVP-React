import type { TransactionReq } from './generated/models';
import type { RefundDocument } from './document-types';

// Builds the request that gives a package payment back (Transactions/Transaction, CardCom's "Do Transaction"). Pure: it reads
// nothing and sends nothing, so every rule can be pinned by a test. The owner chose this operation (9.10.2026) because it
// refunds AND issues the credit document in one call — RefundByTransactionId issues none, and Documents/CancelDoc answered 9006.
//
// The rules, from CardCom's OpenAPI and its "Do Transaction" article:
//   - Advanced.IsRefund makes it a refund, and then Advanced.ApiPassword is required ("Required only if 'IsRefund' is true");
//   - it charges a TOKEN (the payment's, kept on its ledger row) with its expiry as MMYY ("תאריך תוקף של האסימון - חיוני");
//   - Document "will create document if transaction succeeded"; Name is required; without Products no document is produced
//     ("אמנם מערך של products הוא לא חובה אך בלעדיו לא יופק המסמך"); the type is the credit counterpart of the payment's
//     document (document-types.ts);
//   - ExternalUniqTranId is our ledger row id: if the same id is sent again CardCom does not move money again, and with
//     ExternalUniqUniqTranIdResponse it answers with the ORIGINAL transaction instead of error 608;
//   - one payment, in shekels.
// The amount is the money that goes back, as a positive number: CardCom's material shows no refund example, and IsRefund is
// what marks the direction. The first real refund confirms it.

export type CardcomRefundInput = {
  terminalNumber: number;
  apiName: string;
  apiPassword: string;
  /** Our pending ledger row for this refund: the idempotency key CardCom keeps. */
  operationId: string;
  amount: number;
  token: string;
  expMonth: number;
  expYear: number;
  document: RefundDocument;
  /** Who the credit document is to: the cardholder CardCom recorded on the payment. */
  holder: { name: string; email: string | null };
  /** The one line on the credit document. */
  line: string;
};

const hasMoreDecimals = (n: number, places: number) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) > 1e-6;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "MMYY" from a month (1-12) and a year (2031 or 31). Null when either cannot be one.
export function expiryMMYY(month: number, year: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 0) return null;
  const yy = year >= 100 ? year % 100 : year;
  return `${String(month).padStart(2, '0')}${String(yy).padStart(2, '0')}`;
}

export function buildRefundTransaction(input: CardcomRefundInput): TransactionReq {
  const apiName = input.apiName.trim();
  const name = input.holder.name.trim().slice(0, 50);
  const expiry = expiryMMYY(input.expMonth, input.expYear);
  if (
    apiName === '' || input.apiPassword === '' || name === '' || input.line.trim() === '' || !expiry ||
    !GUID.test(input.token) || !Number.isFinite(input.amount) || input.amount <= 0 || hasMoreDecimals(input.amount, 2)
  ) {
    throw new Error('בקשת זיכוי ל-CardCom אינה תקינה');
  }
  const email = input.holder.email?.trim();
  return {
    TerminalNumber: input.terminalNumber,
    ApiName: apiName,
    Amount: input.amount,
    Token: input.token,
    CardExpirationMMYY: expiry,
    ExternalUniqTranId: input.operationId,
    ExternalUniqUniqTranIdResponse: true,
    NumOfPayments: 1,
    ISOCoinId: 1,
    Advanced: { IsRefund: true, ApiPassword: input.apiPassword },
    Document: {
      DocumentTypeToCreate: input.document.create,
      Name: name,
      ...(email ? { Email: email.slice(0, 50) } : {}),
      Languge: 'he',
      Products: [{ Description: input.line, Quantity: 1, UnitCost: input.amount }],
    },
  };
}
