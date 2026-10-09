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

// The NUMBER CardCom's document report gives a document type (its "DocType" / "ExtReadInvoiceHead.InvoiceType" fields), as
// the generated DocumentType name. The numbers are CardCom's own list in its "ביטול מסמך" article (support.cardcom.solutions
// 25537411371026, DocumentType table); each is paired with its name through the Hebrew label both that article and the
// "Do Transaction" article (25269208059282) give it. Confirmed by real reports: 3 (receipt 6, "Receipt") and 4 (credit receipt
// 2, "ReceiptRefund"), 8–9.10.2026. Left out on purpose: 101/102 ("אישור הזמנה - מאתר" and its refund), whose name the
// articles give as OrderConfirmation while the generated answer enum calls it SiteCustomerOrder, and 303/304 ("חשבון קבלה"),
// which has no name in the answer enum — a number not here is "unknown", never guessed.
const BY_REPORT_NUMBER: Readonly<Record<string, DocumentType>> = {
  '1': DocumentType.TaxInvoiceAndReceipt,
  '2': DocumentType.TaxInvoiceAndReceiptRefund,
  '3': DocumentType.Receipt,
  '4': DocumentType.ReceiptRefund,
  '50': DocumentType.Quote,
  '100': DocumentType.Order,
  '200': DocumentType.DeliveryNote,
  '210': DocumentType.DeliveryNoteRefund,
  '300': DocumentType.ProformaInvoice,
  '301': DocumentType.DemandForPayment,
  '302': DocumentType.DemandForPaymentRefund,
  '305': DocumentType.TaxInvoice,
  '330': DocumentType.TaxInvoiceRefund,
  '400': DocumentType.ReceiptForTaxInvoice,
  '405': DocumentType.DonationReceipt,
  '406': DocumentType.DonationReceiptRefund,
  '410': DocumentType.ReceiptForTaxInvoiceRefund,
};

// The name of the document type a report gives as a number, or null when the number is not one we can name.
export function documentTypeOfReportNumber(reported: string | null): DocumentType | null {
  return reported !== null && Object.hasOwn(BY_REPORT_NUMBER, reported) ? BY_REPORT_NUMBER[reported] : null;
}
