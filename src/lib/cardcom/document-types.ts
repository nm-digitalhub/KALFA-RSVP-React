import { DocumentToCreate, DocumentType } from './generated/models';

// The credit document a refund issues, from the document the payment issued. A refund is a Do Transaction with
// Advanced.IsRefund and a Document object ("will create document if transaction succeeded" — CardCom's OpenAPI): the document
// to create is named, and CardCom answers with the type it created. Both sides are CardCom's own names, from the generated
// enums (DocumentToCreate for the request, DocumentType for the answer) — no numbers are involved.
//
// Deliberately tiny: only the two types a package purchase can produce. The purchase sends "Auto", and the account's settings
// pick the type (for an exempt dealer a "Receipt"). Anything else — a test terminal's order confirmation, a type not stored —
// is refused, never guessed: the refund would otherwise issue the wrong kind of tax document.
const REFUND_OF = {
  [DocumentType.Receipt]: { create: DocumentToCreate.ReceiptRefund, answered: DocumentType.ReceiptRefund },
  [DocumentType.TaxInvoiceAndReceipt]: {
    create: DocumentToCreate.TaxInvoiceAndReceiptRefund,
    answered: DocumentType.TaxInvoiceAndReceiptRefund,
  },
} as const;

export type RefundDocument = (typeof REFUND_OF)[keyof typeof REFUND_OF];

// The credit document for a payment whose document CardCom named `issued` (kept on the purchase's ledger row), or null.
export function refundDocumentFor(issued: unknown): RefundDocument | null {
  return typeof issued === 'string' && Object.hasOwn(REFUND_OF, issued) ? REFUND_OF[issued as keyof typeof REFUND_OF] : null;
}
