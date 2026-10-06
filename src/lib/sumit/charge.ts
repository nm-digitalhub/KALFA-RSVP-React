import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { sumitStatus } from '@/lib/sumit/status';
import type { components } from '@/lib/sumit/types.generated';

const SUMIT_CHARGE_URL = 'https://api.sumit.co.il/billing/payments/charge/';

// The /billing/payments/charge/ request body, keyed by SUMIT's own swagger
// (types.generated.ts) so a misspelled or invented field fails `tsc`.
// chargeSumit and capture.ts type their body with
// `satisfies SumitChargeRequestBody`.
//
// Three fields are re-declared, because the generated types cannot be assigned
// as-is:
//   - PaymentMethod and ChargeItem.Item are generated as `null & {...}`, which
//     no object satisfies.
//   - PaymentMethodType is generated as the label "CreditCard (1)", while the
//     live API takes the number 1 (verified 2026-07-01; a body without it
//     returns "Type should be set to CreditCard or DirectDebit").
// Property NAMES still come from the generated schemas.
type ChargeSchemas = components['schemas'];
type GeneratedChargeRequest =
  ChargeSchemas['OfficeGuy.Apps.Billing.MVC.API.PaymentsController_Payments_Charge_Request'];
type GeneratedPaymentMethod = ChargeSchemas['OfficeGuy.Apps.Billing.MVC.API.Typed.PaymentMethod'];
type GeneratedChargeItem = ChargeSchemas['OfficeGuy.Apps.Billing.MVC.API.Typed.ChargeItem'];
type GeneratedIncomeItem = ChargeSchemas['Accounting_Typed_IncomeItem'];

export type SumitChargeRequestBody = Omit<
  GeneratedChargeRequest,
  'PaymentMethod' | 'Items' | 'UpdateCustomerByEmail_Language' | 'DocumentLanguage' | 'DocumentType'
> & {
  PaymentMethod?: Omit<GeneratedPaymentMethod, 'Type'> & { Type: 1 };
  Items: (Omit<GeneratedChargeItem, 'Item' | 'Currency'> & {
    Item?: Pick<GeneratedIncomeItem, 'Name'>;
  })[];
};

export interface SumitChargeParams {
  companyId: number;         // SUMIT CompanyID — from admin-managed DB config
  apiKey: string;            // SUMIT private API key — from admin-managed DB config (server-only)
  ogToken: string;           // the single-use token payments.js produced in the browser
  // The FINAL price, as a Postgres numeric string (no float distortion). KALFA is an exempt dealer: no VAT field is
  // ever sent, so this is exactly what the customer pays. Computed on the server, never taken from the browser.
  amount: string;
  description: string;       // the receipt line (Item.Name and Description)
  externalRef: string;       // UUID → Customer.ExternalIdentifier, our reconciliation anchor
  customerEmail: string;     // empty string → no receipt by email
  customerName?: string;     // required by SUMIT when it has to CREATE the customer
  // The paying account's known SUMIT customer number (sumit_customers). Present → Customer.ID, so this charge reuses
  // that customer; absent → SUMIT opens one and returns its number in `sumitCustomerId`.
  customerId?: number | null;
}

// The part of Data.Payment.PaymentMethod we keep. The caller feeds it to cardFromSumit (token, expiry, last four) and
// takes the citizen id from it for the Vault; this module never persists anything.
export interface SumitChargePaymentMethod {
  Type?: unknown;
  CreditCard_Token?: string | null;
  CreditCard_ExpirationMonth?: number | null;
  CreditCard_ExpirationYear?: number | null;
  CreditCard_LastDigits?: string | null;
  CreditCard_CardMask?: string | null;
  CreditCard_CitizenID?: string | null;
}

export interface SumitChargeResult {
  documentId: number;
  documentNumber: number | null;
  documentUrl: string | null;
  paymentId: number | null;
  authNumber: string | null;
  // As SUMIT returned them, not our wording.
  status: string | null;
  statusDescription: string | null;
  // Data.CustomerID (top level — Data.Payment.CustomerID is not the customer).
  sumitCustomerId: number | null;
  // Null when SUMIT returned no reusable card.
  paymentMethod: SumitChargePaymentMethod | null;
}

export class SumitNetworkError extends Error {
  readonly isNetworkError = true;
  constructor(msg: string) { super(msg); this.name = 'SumitNetworkError'; }
}

// Thrown only for a DEFINITIVE decline in a 2xx response: SUMIT refused the
// request (a BusinessError status) or the issuer refused the payment
// (Data.Payment.ValidPayment === false, e.g. code 004). No money moved on that request.
// Any other error type (network, parse failure, missing DocumentID, unexpected throw)
// is treated as unknown outcome → review, not failed.
export class SumitDeclinedError extends Error {
  constructor() { super('payment_declined'); this.name = 'SumitDeclinedError'; }
}

const SUMIT_CHARGE_TIMEOUT_MS = 60_000;

// The package PURCHASE: one real charge (J4, AutoCapture true) on the card the customer typed into SUMIT's own form,
// with a real receipt.
//
// What the body deliberately leaves out:
//   - VATIncluded / VATRate — owner decision 2.9.2026 (an exempt dealer); an explicit rate also unbalances the document.
//   - CardTokenNotNeeded — its DEFAULT makes SUMIT generate and keep a reusable token on the customer's payment
//     method, which an upgrade or a refund needs (the spec: "Avoids generating credit card token and saving it on the
//     customer payment method. Defaults to False").
//
// Outcomes (the same split as authorize.ts / capture.ts, via the shared status classifier):
//   - SumitDeclinedError: SUMIT refused the request, or the issuer refused the payment (ValidPayment false). Nothing
//     was charged; retrying is safe.
//   - SumitNetworkError: anything else — the network, a non-2xx answer, an unreadable body, a timeout, a status we do
//     not recognise, a "valid" payment with no receipt. The money MAY have moved, so the caller records REVIEW and
//     never retries on its own.
export async function chargeSumit(params: SumitChargeParams): Promise<SumitChargeResult> {
  const unitPrice = parseFloat(params.amount);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error('סכום החיוב אינו תקין');
  }

  const body = {
    Credentials: { CompanyID: params.companyId, APIKey: params.apiKey },
    Customer: {
      ID: params.customerId ?? undefined,
      Name: params.customerName || undefined,
      EmailAddress: params.customerEmail || undefined,
      ExternalIdentifier: params.externalRef, // reconciliation anchor
    },
    Items: [
      {
        Quantity: 1,
        UnitPrice: unitPrice,
        // SUMIT requires the Item object (IncomeItem.Name), not just a Description.
        Item: { Name: params.description },
        Description: params.description,
      },
    ],
    SingleUseToken: params.ogToken,
    AutoCapture: true, // J4: a real, immediate charge
    PreventDocumentCreation: false, // a real receipt
    // An empty address would make SUMIT error or silently drop the receipt.
    SendDocumentByEmail: !!params.customerEmail,
    DraftDocument: false,
  } satisfies SumitChargeRequestBody;

  let res: Response;
  try {
    res = await fetch(SUMIT_CHARGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // A call that hangs must not leave a payment row pending for ever: after this it is "we do not know" → review.
      signal: AbortSignal.timeout(SUMIT_CHARGE_TIMEOUT_MS),
    });
  } catch {
    // The thrown message can echo the request, and the request body holds the token and the key.
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: 'network', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }

  if (!res.ok) {
    // Any non-2xx: the request may have reached SUMIT (especially a 5xx). Unknown.
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: `http_${res.status}`, source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
  }

  type Payment = {
    ID?: number | null;
    ValidPayment?: boolean | null;
    Status?: string | null;
    StatusDescription?: string | null;
    AuthNumber?: string | null;
    PaymentMethod?: SumitChargePaymentMethod | null;
  } | null;
  type Resp = {
    Status?: unknown;
    Data?: {
      DocumentID?: number | null;
      DocumentNumber?: number | null;
      DocumentDownloadURL?: string | null;
      CustomerID?: number | null;
      Payment?: Payment;
    } | null;
  };

  let json: Resp;
  try {
    json = (await res.json()) as Resp;
  } catch {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: 'invalid_response', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  const status = sumitStatus(json.Status);
  const payment = json.Data?.Payment;

  // Definitive: SUMIT refused the request (BusinessError), or the request was fine and the ISSUER refused the payment —
  // the top-level status is 0 in that case, so the payment itself must be inspected.
  if (status === 'business_error' || payment?.ValidPayment === false) {
    throw new SumitDeclinedError();
  }

  const documentId = json.Data?.DocumentID;
  // Success needs ALL of: a success status, an explicitly valid payment, and a receipt document. Anything less is
  // ambiguous — a "valid" payment with no receipt, for one, is exactly the half-finished state a person must look at.
  if (status !== 'success' || payment?.ValidPayment !== true || !documentId) {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: 'unconfirmed', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('אישור התשלום לא התקבל ממערכת');
  }

  return {
    documentId,
    documentNumber: json.Data?.DocumentNumber ?? null,
    documentUrl: json.Data?.DocumentDownloadURL ?? null,
    paymentId: payment.ID ?? null,
    // AuthNumber sometimes arrives with a leading space.
    authNumber: payment.AuthNumber?.trim() || null,
    status: payment.Status ?? null,
    statusDescription: payment.StatusDescription ?? null,
    sumitCustomerId: json.Data?.CustomerID ?? null,
    paymentMethod: payment.PaymentMethod ?? null,
  };
}
