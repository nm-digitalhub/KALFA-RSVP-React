import 'server-only';

import { SumitNetworkError } from './charge';

// SUMIT's ACCOUNTING surface — documents and customers. No money moves here.
//
// WHY THIS IS A SEPARATE MODULE FROM THE CLEARING ONES. authorize/capture/charge
// reserve, take and return money; these two create a record. Keeping them apart
// is what lets a workflow node issue a receipt without the port that can charge
// a card being in scope at all.
//
// Every field below is taken from swagger.json (the SUMIT API spec vendored in
// this repo) — `Accounting_Documents_Create_Request`,
// `Accounting_Typed_DocumentDetails`, `Accounting_Typed_Customer`,
// `Accounting_Typed_DocumentItem` and their two response shapes. Nothing is
// guessed: a field that is not in the spec is not sent.
//
// ⚠️ VAT. The business is an עוסק פטור. The spec documents two separate
// switches and they are NOT interchangeable:
//   • `VATRate` on the request — "Document VAT Rate. Leave empty for company
//     default." Left ABSENT here, exactly as authorize.ts and capture.ts do, so
//     the company default governs and this module never asserts a rate.
//   • `Customer.NoVAT` — "NoVAT indication. Set to true for VAT exempt
//     customers." That describes the CUSTOMER, not us, so it is exposed as an
//     explicit option rather than defaulted.

/**
 * A document or customer SUMIT definitively REFUSED, carrying its own reason.
 *
 * Deliberately NOT `SumitDeclinedError`: that one means "the card was declined"
 * — its message is the literal `payment_declined` and it takes no argument. A
 * rejected document is a different event with a different audience, and reusing
 * the payment error would make a bookkeeping failure read as a money failure in
 * every log and alert downstream.
 */
export class SumitAccountingError extends Error {
  readonly isBusinessError = true;
  constructor(message: string) {
    super(message);
    this.name = 'SumitAccountingError';
  }
}

const SUMIT_DOCUMENT_CREATE_URL = 'https://api.sumit.co.il/accounting/documents/create/';
const SUMIT_CUSTOMER_CREATE_URL = 'https://api.sumit.co.il/accounting/customers/create/';

/**
 * `Accounting_Typed_DocumentType` (swagger enum), as the names SUMIT accepts.
 *
 * The full enum carries 23 values including expense and supplier documents.
 * Only the ones an outgoing customer-facing flow can legitimately produce are
 * listed; an expense document is bookkeeping for something WE bought and has no
 * business being issued by an automation.
 *
 * ⚠️ `Invoice` and `InvoiceAndReceipt` are חשבונית מס — a document an עוסק
 * פטור may not issue. They stay in the type because SUMIT accepts them and the
 * company may change status, and the node that uses this refuses them by
 * default; see the catalogue schema.
 */
export type SumitDocumentType =
  | 'Invoice'
  | 'InvoiceAndReceipt'
  | 'Receipt'
  | 'DonationReceipt'
  | 'ProformaInvoice'
  | 'PaymentRequest'
  | 'PriceQuotation'
  | 'CreditInvoice'
  | 'CreditInvoiceAndReceipt'
  | 'CreditReceipt'
  | 'Order'
  | 'DeliveryNote';

/** `Accounting_Typed_DocumentPayment.Type` (swagger enum). */
export type SumitPaymentType =
  | 'General'
  | 'Cash'
  | 'BankTransfer'
  | 'Cheque'
  | 'CreditCard'
  | 'Digital'
  | 'TaxWithholding'
  | 'Other';

/** `Accounting_Typed_DocumentDetails.Language` values used here. */
export type SumitDocumentLanguage = 'Hebrew' | 'English' | 'Arabic' | 'Spanish';

/** One `Accounting_Typed_DocumentItem`. */
export type SumitDocumentItem = {
  /** Spec: "Quantity. Defaults to 1". */
  quantity?: number;
  /** Spec: "Single Unit price in ILS". */
  unitPrice: number;
  /** `Item.Name` — SUMIT rejects a Description-only item ("Missing Item details"). */
  name: string;
  description?: string;
};

export type SumitCustomerInput = {
  /** Spec: "Leave empty to create a new entity". */
  id?: number;
  /** Spec: "Required for creating a new customer". */
  name?: string;
  phone?: string;
  emailAddress?: string;
  city?: string;
  address?: string;
  zipCode?: string;
  /** Spec: "Customer registered company number (VAT number)". */
  companyNumber?: string;
  /** Spec: "External identifier from your system" — the reconciliation anchor. */
  externalIdentifier?: string;
  /** Spec: "Set to true for VAT exempt customers". Describes the CUSTOMER. */
  noVat?: boolean;
};

export type CreateDocumentParams = {
  companyId: number;
  apiKey: string;
  type: SumitDocumentType;
  customer: SumitCustomerInput;
  items?: SumitDocumentItem[];
  /** `Payments[]` — spec: "Can be used in invoice+receipt/receipt". */
  payments?: { amount: number; type?: SumitPaymentType }[];
  /** Spec: "Save document as draft. Leave empty for final document". */
  isDraft?: boolean;
  sendByEmail?: boolean;
  language?: SumitDocumentLanguage;
  description?: string;
  /** Spec: "Is VAT included in the prices?" — about the ITEM prices we send. */
  vatIncluded?: boolean;
};

export type CreateDocumentResult = {
  documentId: number;
  documentNumber: number | null;
  customerId: number | null;
  documentDownloadUrl: string | null;
  documentPaymentUrl: string | null;
};

export type CreateCustomerParams = {
  companyId: number;
  apiKey: string;
} & SumitCustomerInput;

export type CreateCustomerResult = {
  customerId: number;
  customerHistoryUrl: string | null;
};

// The envelope every SUMIT endpoint answers with
// (`Response_Accounting_*`): Status + UserErrorMessage +
// TechnicalErrorDetails + Data. Same discriminator the clearing modules use.
type SumitEnvelope<T> = {
  Status?: number | string | { IsError?: boolean } | null;
  UserErrorMessage?: string | null;
  TechnicalErrorDetails?: string | null;
  Data?: T | null;
};

function isBusinessError(status: SumitEnvelope<unknown>['Status']): boolean {
  return (
    status === 1 ||
    (typeof status === 'string' && /business|\(1\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === true)
  );
}

function isSuccess(status: SumitEnvelope<unknown>['Status']): boolean {
  return (
    status === 0 ||
    (typeof status === 'string' && /success|\(0\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === false)
  );
}

// Shared transport. Mirrors the error semantics of charge.ts/capture.ts exactly:
// only a DEFINITIVE business error is a SumitDeclinedError; anything ambiguous
// is a SumitNetworkError so the caller retries or reviews rather than treating
// an unknown outcome as success.
//
// The provider's own message is carried on the thrown error, because SUMIT
// answers a rejected document with Status 1 and an otherwise empty body — the
// reason is the only actionable part (verified live 2026-09-22, when
// "Invalid CreditCard_Token (Guid expected)" was findable ONLY in SUMIT's log).
async function postSumit<T>(url: string, body: unknown, label: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת החשבונות');
  }
  if (!res.ok) {
    throw new SumitNetworkError('לא התקבלה תשובה תקינה ממערכת החשבונות');
  }

  let json: SumitEnvelope<T>;
  try {
    json = (await res.json()) as SumitEnvelope<T>;
  } catch {
    throw new SumitNetworkError('תגובה לא תקינה ממערכת החשבונות');
  }

  const reason = json.UserErrorMessage || json.TechnicalErrorDetails || '';
  if (isBusinessError(json.Status)) {
    throw new SumitAccountingError(reason || `${label} נדחתה על ידי מערכת החשבונות`);
  }
  if (!isSuccess(json.Status) || !json.Data) {
    throw new SumitNetworkError(reason || `${label}: לא התקבל אישור חד משמעי`);
  }
  return json.Data;
}

// `Accounting_Typed_Customer`. Optional keys are OMITTED when empty rather than
// sent as '' — the same rule capture.ts follows, so SUMIT never has to tell a
// deliberately-blank field apart from one that resolved to nothing.
function customerPayload(c: SumitCustomerInput): Record<string, unknown> {
  return {
    ...(c.id != null ? { ID: c.id } : {}),
    ...(c.name ? { Name: c.name } : {}),
    ...(c.phone ? { Phone: c.phone } : {}),
    ...(c.emailAddress ? { EmailAddress: c.emailAddress } : {}),
    ...(c.city ? { City: c.city } : {}),
    ...(c.address ? { Address: c.address } : {}),
    ...(c.zipCode ? { ZipCode: c.zipCode } : {}),
    ...(c.companyNumber ? { CompanyNumber: c.companyNumber } : {}),
    ...(c.externalIdentifier ? { ExternalIdentifier: c.externalIdentifier } : {}),
    ...(typeof c.noVat === 'boolean' ? { NoVAT: c.noVat } : {}),
  };
}

/** Create an accounting document. No money moves; this records one. */
export async function createDocumentSumit(
  p: CreateDocumentParams,
): Promise<CreateDocumentResult> {
  const data = await postSumit<{
    DocumentID?: number | null;
    DocumentNumber?: number | null;
    CustomerID?: number | null;
    DocumentDownloadURL?: string | null;
    DocumentPaymentURL?: string | null;
  }>(
    SUMIT_DOCUMENT_CREATE_URL,
    {
      Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
      Details: {
        Type: p.type,
        Customer: customerPayload(p.customer),
        ...(typeof p.isDraft === 'boolean' ? { IsDraft: p.isDraft } : {}),
        ...(typeof p.sendByEmail === 'boolean' ? { SendByEmail: p.sendByEmail } : {}),
        ...(p.language ? { Language: p.language } : {}),
        ...(p.description ? { Description: p.description } : {}),
      },
      ...(p.items && p.items.length > 0
        ? {
            Items: p.items.map((i) => ({
              Quantity: i.quantity ?? 1,
              UnitPrice: i.unitPrice,
              Item: { Name: i.name },
              ...(i.description ? { Description: i.description } : {}),
            })),
          }
        : {}),
      ...(p.payments && p.payments.length > 0
        ? {
            Payments: p.payments.map((pay) => ({
              Amount: pay.amount,
              ...(pay.type ? { Type: pay.type } : {}),
            })),
          }
        : {}),
      ...(typeof p.vatIncluded === 'boolean' ? { VATIncluded: p.vatIncluded } : {}),
      // No VATRate — the company default governs. See the header.
    },
    'יצירת המסמך',
  );

  if (data.DocumentID == null) {
    throw new SumitNetworkError('המסמך נוצר אך לא הוחזר מזהה — נדרשת בדיקה ב-SUMIT');
  }

  return {
    documentId: data.DocumentID,
    documentNumber: data.DocumentNumber ?? null,
    customerId: data.CustomerID ?? null,
    documentDownloadUrl: data.DocumentDownloadURL ?? null,
    documentPaymentUrl: data.DocumentPaymentURL ?? null,
  };
}

/** Create a customer record. */
export async function createCustomerSumit(
  p: CreateCustomerParams,
): Promise<CreateCustomerResult> {
  const { companyId, apiKey, ...customer } = p;
  const data = await postSumit<{
    CustomerID?: number | null;
    CustomerHistoryURL?: string | null;
  }>(
    SUMIT_CUSTOMER_CREATE_URL,
    {
      Credentials: { CompanyID: companyId, APIKey: apiKey },
      Details: customerPayload(customer),
    },
    'יצירת הלקוח',
  );

  if (data.CustomerID == null) {
    throw new SumitNetworkError('הלקוח נוצר אך לא הוחזר מזהה — נדרשת בדיקה ב-SUMIT');
  }

  return {
    customerId: data.CustomerID,
    customerHistoryUrl: data.CustomerHistoryURL ?? null,
  };
}
