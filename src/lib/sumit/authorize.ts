import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { SumitDeclinedError, SumitNetworkError } from './charge';

const SUMIT_CHARGE_URL = 'https://api.sumit.co.il/billing/payments/charge/';

export interface SumitAuthorizeParams {
  companyId: number;
  apiKey: string;
  ogToken: string;
  ceiling: string; // Postgres numeric as string — the J5 hold amount
  vatRate: string;
  authRef: string; // Customer.ExternalIdentifier — reconciliation anchor
  customerEmail: string;
  customerName?: string;
  // The paying account's known SUMIT customer number (sumit_customers), if
  // any. Present → send Customer.ID so this hold reuses that customer instead
  // of creating a new one (SearchMode defaults to None = always-create when
  // ID is absent). Absent → the one-time create/bridge path.
  customerId?: number | null;
}

export interface SumitAuthorizeResult {
  authNumber: string;
  cardToken: string | null; // reusable CreditCard_Token for the final capture
  // Card expiry from the response — REQUIRED alongside the token at capture
  // (SUMIT validates CreditCard_ExpirationMonth/Year structurally). Month/year
  // only; never the PAN/CVV.
  expMonth: number | null;
  expYear: number | null;
  // Card-holder CitizenID — SUMIT requires it on the saved-token charge. PII;
  // retention is anchored in the signed agreement.
  citizenId: string | null;
  // The draft "Order" document SUMIT creates for this hold (Data.DocumentID on
  // the charge response — same field capture.ts reads for the receipt). Not
  // sensitive; persisted so the hold is traceable in the SUMIT UI.
  orderDocumentId: number | null;
  // Data.DocumentNumber — the human-readable number shown in the SUMIT UI
  // ("הזמנה / 1002"), distinct from the internal DocumentID. Mirrors
  // capture.ts/close-charge's documentNumber for the receipt (same pattern).
  orderDocumentNumber: number | null;
  // Data.DocumentDownloadURL — direct link to the document itself (verified
  // 2026-08-30: NOT the same ID space as the SUMIT UI's browsable CRM entity
  // URL, f<folder>/c<entityId> — that entity ID is not returned by this
  // endpoint at all). This is the reliable admin-facing "view" link.
  orderDocumentUrl: string | null;
  // Data.CustomerID (top-level — NOT Data.Payment.CustomerID, which is 0 on a
  // hold, verified live 2026-08-30). Pass back as Customer.ID at close-charge
  // so the final charge reuses THIS SUMIT customer instead of creating a new
  // one — a real bug reproduced today: a saved-token charge without it created
  // a brand-new customer despite reusing the same card token.
  sumitCustomerId: number | null;
}

// J5 authorization HOLD (no capture, no document). Mirrors charge.ts error
// semantics: only a definitive decline (Status===1 / {IsError:true} in a 2xx
// body) is a SumitDeclinedError; anything else ambiguous → SumitNetworkError, so
// the caller marks hold_review rather than silently treating it as authorized.
// NB: the exact live success/error discriminator must be confirmed against the
// admin POC before go-live (see the plan's Task 8).
export async function authorizeHoldSumit(
  p: SumitAuthorizeParams,
): Promise<SumitAuthorizeResult> {
  const body = {
    Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
    Customer: {
      ID: p.customerId ?? undefined,
      Name: p.customerName || undefined,
      EmailAddress: p.customerEmail || undefined,
      ExternalIdentifier: p.authRef,
    },
    VATIncluded: true,
    VATRate: parseFloat(p.vatRate),
    Items: [
      {
        Quantity: 1,
        UnitPrice: parseFloat(p.ceiling),
        // SUMIT requires the Item object (IncomeItem.Name), not just a
        // Description — a Description-only item returns "Missing Item details".
        Item: { Name: 'KALFA — תפיסת מסגרת לקמפיין' },
        Description: 'KALFA — תפיסת מסגרת לקמפיין',
      },
    ],
    SingleUseToken: p.ogToken,
    AutoCapture: false, // J5 = authorize / hold only (no capture)
    AuthorizeAmount: parseFloat(p.ceiling),
    // Deliberately NOT setting PreventDocumentCreation — SUMIT's documented J5
    // flow issues a draft "Order" document per hold (verified live 2026-08-30,
    // help.sumit.co.il/he/articles/5832974: the "תפיסות מסגרת" screen tracks each
    // hold via this document, with an explicit charge/release action against it).
    // We keep and persist its DocumentID so a hold is traceable/reconcilable in
    // the SUMIT UI, not just in our own DB.
    SendDocumentByEmail: false,
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
    void sendSlackAlert({ level: 'warn', title: 'SUMIT authorize failed', detail: 'network', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }
  if (!res.ok) {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT authorize failed', detail: `http_${res.status}`, source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
  }

  // SUMIT response envelope (Response_OfficeGuy). Per the official swagger:
  //   Status = Teva.Common.ResponseStatus enum: Success (0) / BusinessError (1) /
  //   TechnicalError (2). Data.Payment.ValidPayment is the validity flag, AuthNumber
  //   the auth code, and the reusable token lives on Payment.PaymentMethod.
  //   CreditCard_Token. We accept the wire Status as a number, the enum string, or
  //   the legacy { IsError } object so the adapter is robust to all three forms.
  type PaymentMethod = {
    CreditCard_Token?: string | null;
    CreditCard_ExpirationMonth?: number | string | null;
    CreditCard_ExpirationYear?: number | string | null;
    CreditCard_CitizenID?: string | null;
  } | null;
  type Payment = {
    AuthNumber?: string | null;
    ValidPayment?: boolean | null;
    PaymentMethod?: PaymentMethod;
  } | null;
  type Resp = {
    Status?: number | string | { IsError?: boolean } | null;
    Data?: {
      Payment?: Payment;
      PaymentMethod?: PaymentMethod;
      CreditCard_Token?: string | null;
      DocumentID?: number | null;
      DocumentNumber?: number | null;
      DocumentDownloadURL?: string | null;
      CustomerID?: number | null;
    } | null;
  };
  let json: Resp;
  try {
    json = (await res.json()) as Resp;
  } catch {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT authorize failed', detail: 'invalid_response', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  const status = json.Status;
  // BusinessError (1) = a definitive decline (safe to surface as declined/retry).
  const businessError =
    status === 1 ||
    (typeof status === 'string' && /business|\(1\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === true);
  if (businessError) throw new SumitDeclinedError();

  const success =
    status === 0 ||
    (typeof status === 'string' && /success|\(0\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === false);

  const payment = json.Data?.Payment;
  const authNumber = payment?.AuthNumber;
  // Treat as authorized ONLY on a clear Success status AND an AuthNumber AND
  // ValidPayment EXPLICITLY true — symmetric with capture.ts. An undefined/null
  // ValidPayment, a TechnicalError (2), or any unrecognized status is ambiguous
  // and becomes a review (SumitNetworkError), never a silent authorization.
  const authorized =
    success && !!authNumber && payment?.ValidPayment === true;
  if (!authorized || !authNumber) {
    void sendSlackAlert({ level: 'warn', title: 'SUMIT authorize failed', detail: 'unconfirmed', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('אישור התפיסה לא התקבל ממערכת');
  }

  const pm = payment?.PaymentMethod ?? json.Data?.PaymentMethod ?? null;
  const cardToken =
    pm?.CreditCard_Token ?? json.Data?.CreditCard_Token ?? null;
  const toInt = (v: number | string | null | undefined): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    authNumber,
    cardToken,
    expMonth: toInt(pm?.CreditCard_ExpirationMonth),
    expYear: toInt(pm?.CreditCard_ExpirationYear),
    citizenId: pm?.CreditCard_CitizenID ?? null,
    orderDocumentId: json.Data?.DocumentID ?? null,
    orderDocumentNumber: json.Data?.DocumentNumber ?? null,
    orderDocumentUrl: json.Data?.DocumentDownloadURL ?? null,
    sumitCustomerId: json.Data?.CustomerID ?? null,
  };
}
