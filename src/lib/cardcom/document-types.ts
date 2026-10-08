// CancelDoc takes the document it cancels as a NUMBER and a TYPE. CardCom's answers (GetLpResult) name the type ("Receipt");
// its request wants a number, and the OpenAPI document lists the names but not the numbers.
//
// ⚠️ THE NUMBERS BELOW ARE AN INFERENCE, NOT A MEASUREMENT: they are the position of each name in CardCom's own DocumentType
// list (Error = 0, TaxInvoiceAndReceipt = 1, TaxInvoiceAndReceiptRefund = 2, Receipt = 3, ReceiptRefund = 4, …). A wrong
// number could cancel a DIFFERENT document that happens to share the number (document numbers are per type), so this table is
// deliberately tiny — only the two types a package purchase can produce — and every refund checks CardCom's answer against it:
// the new document must be the refund counterpart of the one we asked to cancel, or the refund is not believed (it goes to
// review). The first real refund (plan, section 7: acceptance) is what confirms the table; until then the pilot is closed to
// customers. Anything not in the table is refused, never guessed.
const CANCELABLE = {
  TaxInvoiceAndReceipt: { type: 1, refundType: 2 },
  Receipt: { type: 3, refundType: 4 },
} as const;

export type CancelableDocument = { type: number; refundType: number };

export function cancelableDocument(name: unknown): CancelableDocument | null {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(CANCELABLE, name) ? CANCELABLE[name as keyof typeof CANCELABLE] : null;
}
