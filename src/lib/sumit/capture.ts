import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { SumitDeclinedError, SumitNetworkError } from '@/lib/sumit/charge';

const SUMIT_CHARGE_URL = 'https://api.sumit.co.il/billing/payments/charge/';

export interface SumitCaptureParams {
  companyId: number; // SUMIT CompanyID — admin-managed DB config
  apiKey: string; // SUMIT private API key — server-only
  cardToken: string; // the hold's reusable CreditCard_Token
  expMonth: number; // card expiry month — SUMIT validates it with the token
  expYear: number; // card expiry year
  citizenId: string; // card-holder CitizenID — SUMIT requires it with the token
  externalRef: string; // Customer.ExternalIdentifier — reconciliation anchor
  amount: string; // Postgres numeric as string — no float distortion
  customerEmail: string; // non-empty → SendDocumentByEmail:true (the receipt)
  // Receipt "לכבוד" line — without it SUMIT prints "כרטיס ללא שם"
  // (observed on the live doc-check receipt 40106).
  customerName?: string;
  // The hold's SUMIT customer number (campaigns.sumit_customer_id), when
  // known. Belt-and-braces: the saved token already resolves to the right
  // customer via its own PaymentMethod link, but sending Customer.ID too
  // removes any dependency on that being reliable in every case (verified gap
  // 2026-08-30: a fresh charge with the SAME token but no Customer.ID DID
  // create a new customer in one live test — see
  // plans/sumit-customer-id-reconciliation.md §5a).
  customerId?: number | null;
}

export interface SumitCaptureResult {
  documentId: number; // Data.DocumentID — the receipt document
  documentNumber: number | null; // Data.DocumentNumber — human-facing number
  documentUrl: string | null; // Data.DocumentDownloadURL — receipt download link
  authNumber: string | null; // Data.Payment.AuthNumber — the approval code
  paymentId: number | null; // Data.Payment.ID — SUMIT payment id
}

// Close-charge: charge the card the J5 hold saved, WITHOUT re-entry, via the saved
// CreditCard_Token. Empirically validated against the SUMIT REST API:
//   - PaymentMethod carries the Token + ExpirationMonth/Year + CitizenID + Type:1
//     (all are validated structurally; the expiry/CitizenID are read from the
//     authorize response and stored at the hold).
//   - NO explicit VATRate — the company-default VAT balances the document
//     (sending VATRate produced "products vs payments mismatch").
//   - NO CreditCardAuthNumber — capturing the original (often expired) J5 auth is
//     declined (004); a FRESH charge on the saved token succeeds.
//   - AutoCapture:true + PreventDocumentCreation:false → a real receipt, emailed.
// IMPORTANT: a top-level Status of 0 only means the request was well-formed; the
// PAYMENT can still be DECLINED (Data.Payment.ValidPayment === false, e.g. 004).
// Success requires ValidPayment === true.
export async function captureHeldCardSumit(
  p: SumitCaptureParams,
): Promise<SumitCaptureResult> {
  const body = {
    Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
    Customer: {
      ID: p.customerId ?? undefined,
      Name: p.customerName || undefined,
      EmailAddress: p.customerEmail || undefined,
      ExternalIdentifier: p.externalRef, // reconciliation anchor
    },
    PaymentMethod: {
      CreditCard_Token: p.cardToken,
      CreditCard_ExpirationMonth: p.expMonth,
      CreditCard_ExpirationYear: p.expYear,
      CreditCard_CitizenID: p.citizenId,
      Type: 1,
    },
    VATIncluded: true,
    // No VATRate — use the company default (an explicit rate unbalances the doc).
    Items: [
      {
        Quantity: 1,
        UnitPrice: parseFloat(p.amount),
        // SUMIT requires the Item object (IncomeItem.Name), not just a Description.
        Item: { Name: 'KALFA — חיוב קמפיין' },
        Description: 'KALFA — חיוב קמפיין',
      },
    ],
    AutoCapture: true,
    PreventDocumentCreation: false, // a real receipt at charge time
    SendDocumentByEmail: !!p.customerEmail,
    DraftDocument: false,
  };

  let res: Response;
  try {
    res = await fetch(SUMIT_CHARGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Fail-safe ops alert (non-throwing, no PII). NOT fired for a definite
    // SumitDeclinedError (a business decline, not a provider-API failure).
    void sendSlackAlert({ level: 'warn', title: 'SUMIT capture failed', detail: 'network', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }
  if (!res.ok) {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT capture failed', detail: `http_${res.status}`, source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
  }

  type Payment = {
    ID?: number | null;
    ValidPayment?: boolean | null;
    Status?: string | null;
    AuthNumber?: string | null;
  } | null;
  type Resp = {
    Status?: number | string | { IsError?: boolean } | null;
    Data?: {
      DocumentID?: number | null;
      DocumentNumber?: number | null;
      DocumentDownloadURL?: string | null;
      Payment?: Payment;
    } | null;
  };
  let json: Resp;
  try {
    json = (await res.json()) as Resp;
  } catch {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT capture failed', detail: 'invalid_response', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  // A definitive business decline: top-level BusinessError(1), OR a structurally
  // valid request whose PAYMENT was declined by the issuer (ValidPayment false,
  // e.g. code 004) — the top-level Status is 0 in that case, so we MUST inspect
  // the payment.
  const status = json.Status;
  const payment = json.Data?.Payment;
  const topBusinessError =
    status === 1 ||
    (typeof status === 'string' && /business|\(1\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === true);
  if (topBusinessError || payment?.ValidPayment === false) {
    throw new SumitDeclinedError();
  }

  const topSuccess =
    status === 0 ||
    (typeof status === 'string' && /success|\(0\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === false);
  const documentId = json.Data?.DocumentID;
  // Success requires the payment to be valid AND a receipt document to exist.
  // Anything else is ambiguous → review, never a silent success.
  if (!topSuccess || payment?.ValidPayment !== true || !documentId) {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT capture failed', detail: 'unconfirmed', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('אישור החיוב לא התקבל ממערכת');
  }
  return {
    documentId,
    documentNumber: json.Data?.DocumentNumber ?? null,
    documentUrl: json.Data?.DocumentDownloadURL ?? null,
    authNumber: payment?.AuthNumber ?? null,
    paymentId: payment?.ID ?? null,
  };
}

export type SumitCreditParams = SumitCaptureParams;

// Refund/credit via the SAME /billing/payments/charge/ endpoint
// captureHeldCardSumit uses, with SupportCredit:true + a negative item total —
// verified against the repo-root swagger.json (SUMIT's own OpenAPI spec):
// PaymentsController_Payments_Charge_Request.SupportCredit — "Allow credit
// instead of charge (debit), in case the total is less than 0? Defaults to
// false." ChargeItem.UnitPrice/Total are plain nullable numbers, unrestricted
// to positive values. A credit note document ("תעודת זיכוי") is issued
// automatically, same as captureHeldCardSumit issues a receipt.
// UNTESTED against the live SUMIT API as of this writing — captureHeldCardSumit's
// own hard-won gotchas (no VATRate, no CreditCardAuthNumber, AutoCapture:true)
// may or may not carry over to the credit direction; verify live before relying
// on this for a real customer.
export async function creditHeldCardSumit(
  p: SumitCreditParams,
): Promise<SumitCaptureResult> {
  const body = {
    Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
    Customer: {
      Name: p.customerName || undefined,
      EmailAddress: p.customerEmail || undefined,
      ExternalIdentifier: p.externalRef,
    },
    PaymentMethod: {
      CreditCard_Token: p.cardToken,
      CreditCard_ExpirationMonth: p.expMonth,
      CreditCard_ExpirationYear: p.expYear,
      CreditCard_CitizenID: p.citizenId,
      Type: 1,
    },
    VATIncluded: true,
    SupportCredit: true,
    Items: [
      {
        Quantity: 1,
        UnitPrice: -parseFloat(p.amount),
        Item: { Name: 'KALFA — זיכוי ביטול אירוע' },
        Description: 'KALFA — זיכוי ביטול אירוע',
      },
    ],
    AutoCapture: true,
    PreventDocumentCreation: false,
    SendDocumentByEmail: !!p.customerEmail,
    DraftDocument: false,
  };

  let res: Response;
  try {
    res = await fetch(SUMIT_CHARGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT credit failed', detail: 'network', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }
  if (!res.ok) {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT credit failed', detail: `http_${res.status}`, source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
  }

  type Payment = {
    ID?: number | null;
    ValidPayment?: boolean | null;
    Status?: string | null;
    AuthNumber?: string | null;
  } | null;
  type Resp = {
    Status?: number | string | { IsError?: boolean } | null;
    Data?: {
      DocumentID?: number | null;
      DocumentNumber?: number | null;
      DocumentDownloadURL?: string | null;
      Payment?: Payment;
    } | null;
  };
  let json: Resp;
  try {
    json = (await res.json()) as Resp;
  } catch {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT credit failed', detail: 'invalid_response', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  const status = json.Status;
  const payment = json.Data?.Payment;
  const topBusinessError =
    status === 1 ||
    (typeof status === 'string' && /business|\(1\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === true);
  if (topBusinessError || payment?.ValidPayment === false) {
    throw new SumitDeclinedError();
  }

  const topSuccess =
    status === 0 ||
    (typeof status === 'string' && /success|\(0\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === false);
  const documentId = json.Data?.DocumentID;
  if (!topSuccess || payment?.ValidPayment !== true || !documentId) {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT credit failed', detail: 'unconfirmed', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('אישור הזיכוי לא התקבל ממערכת');
  }
  return {
    documentId,
    documentNumber: json.Data?.DocumentNumber ?? null,
    documentUrl: json.Data?.DocumentDownloadURL ?? null,
    authNumber: payment?.AuthNumber ?? null,
    paymentId: payment?.ID ?? null,
  };
}
