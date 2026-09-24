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
  // The hold's SUMIT customer number (campaigns.sumit_customer_id today; the
  // payment method's provider_customer_id once payments move to their own
  // tables), when known. Belt-and-braces ONLY: a charge on the saved token
  // lands on the customer the token was saved under at hold time — SUMIT's
  // documentation says so and it was verified live 2026-06-29 (₪4 hold + ₪1
  // capture, receipt on the hold's customer; settled 2026-08-27, see
  // plans/sumit-customer-id-reconciliation.md "Problem 2"). Duplicate
  // customers arise only CROSS-campaign (a repeat customer's next HOLD without
  // Customer.ID), which is authorize.ts's concern, not this capture's. Sending
  // Customer.ID here costs nothing and pins the receipt explicitly.
  customerId?: number | null;
  /**
   * OPTIONAL receipt breakdown — one Items row per component ("דמי הפעלה",
   * "אנשי קשר נוספים…") instead of a single opaque "חיוב קמפיין" line, so the
   * customer can see where the total came from.
   *
   * SUMIT derives the charged total from the Items rows, NOT from `amount` — so
   * a breakdown that does not sum to `amount` would charge a different number
   * than the one this system computed, recorded and showed the customer. That
   * is checked here and the breakdown is DROPPED (single `amount` line) unless
   * it reconciles to the agora. The caller may pass one freely; this boundary
   * decides whether it is safe to use.
   *
   * A credit is expressed as ONE negative row, which SUMIT support confirmed is
   * supported and shows as its own line on the document. That confirmation has
   * NOT been reproduced against this account: this same endpoint has rejected an
   * over-specified document before ("products vs payments mismatch", see the
   * VATRate note below). The reconciliation guard is what makes trying it safe —
   * if SUMIT refuses the document the charge errors and the campaign lands in
   * review, so the failure mode is a delayed settlement, never a wrong amount.
   */
  lines?: SumitChargeLine[];
}

/**
 * One receipt row. Quantity × UnitPrice; SUMIT sums the rows into the charge.
 * `unitPrice` may be negative for the single credit row.
 */
export interface SumitChargeLine {
  name: string;
  quantity: number;
  unitPrice: number;
}

function agorot(n: number): number {
  return Math.round(n * 100) / 100;
}

// A breakdown is usable ONLY if it reconciles EXACTLY to the amount this system
// computed, recorded and showed the customer — that equality is the whole
// safety property, because SUMIT charges the sum of the rows and ignores
// `amount`.
//
// Shape rules, each blocking a way a wrong total could look right:
//   • no non-finite value anywhere;
//   • at most ONE negative row (the credit) — several could net a malformed
//     charge row back to a plausible sum;
//   • no zero rows (a zero row is noise on a receipt, never information);
//   • quantity always positive — a negative quantity is a second way to encode
//     a discount and would make "one negative row" unenforceable;
//   • the total must be positive — a zero/negative charge never reaches SUMIT
//     (close-charge settles those as nothing_to_charge before calling).
export function linesReconcile(
  lines: SumitChargeLine[] | undefined,
  amount: number,
): lines is SumitChargeLine[] {
  if (!lines || lines.length === 0) return false;
  if (!Number.isFinite(amount) || agorot(amount) <= 0) return false;
  let sum = 0;
  let negatives = 0;
  for (const l of lines) {
    if (!Number.isFinite(l.quantity) || !Number.isFinite(l.unitPrice)) return false;
    if (l.quantity <= 0) return false;
    if (l.unitPrice === 0) return false;
    if (l.unitPrice < 0) negatives += 1;
    sum += l.quantity * l.unitPrice;
  }
  if (negatives > 1) return false;
  return agorot(sum) === agorot(amount);
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
    // An itemised receipt when the breakdown reconciles to `amount`, else the
    // single opaque line. `linesReconcile` is the gate — see its contract.
    Items: linesReconcile(p.lines, parseFloat(p.amount))
      ? p.lines.map((l) => ({
          Quantity: l.quantity,
          UnitPrice: l.unitPrice,
          // SUMIT requires the Item object (IncomeItem.Name), not just a Description.
          Item: { Name: l.name },
          Description: l.name,
        }))
      : [
          {
            Quantity: 1,
            UnitPrice: parseFloat(p.amount),
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
