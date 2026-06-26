import 'server-only';

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
}

export interface SumitAuthorizeResult {
  authNumber: string;
  cardToken: string | null; // reusable CreditCard_Token for the final capture
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
    PreventDocumentCreation: true, // hold → no Order document to balance
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
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }
  if (!res.ok) {
    throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
  }

  // SUMIT response envelope (Response_OfficeGuy). Per the official swagger:
  //   Status = Teva.Common.ResponseStatus enum: Success (0) / BusinessError (1) /
  //   TechnicalError (2). Data.Payment.ValidPayment is the validity flag, AuthNumber
  //   the auth code, and the reusable token lives on Payment.PaymentMethod.
  //   CreditCard_Token. We accept the wire Status as a number, the enum string, or
  //   the legacy { IsError } object so the adapter is robust to all three forms.
  type PaymentMethod = { CreditCard_Token?: string | null } | null;
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
    } | null;
  };
  let json: Resp;
  try {
    json = (await res.json()) as Resp;
  } catch {
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
  // Treat as authorized ONLY on a clear Success status AND an AuthNumber, with
  // ValidPayment never explicitly false. A TechnicalError (2) or any unrecognized
  // status — even with ValidPayment true — is ambiguous and becomes a review,
  // never a silent authorization.
  const authorized =
    success && !!authNumber && payment?.ValidPayment !== false;
  if (!authorized || !authNumber) {
    throw new SumitNetworkError('אישור התפיסה לא התקבל ממערכת');
  }

  const cardToken =
    payment?.PaymentMethod?.CreditCard_Token ??
    json.Data?.PaymentMethod?.CreditCard_Token ??
    json.Data?.CreditCard_Token ??
    null;
  return { authNumber, cardToken };
}
