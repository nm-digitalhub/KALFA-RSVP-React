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

  type Resp = {
    Status?: number | { IsError?: boolean };
    Data?: {
      Payment?: { AuthNumber?: string | null };
      CreditCard_Token?: string | null;
    };
  };
  let json: Resp;
  try {
    json = (await res.json()) as Resp;
  } catch {
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  // Definite decline: numeric Status===1 OR { IsError:true } (handle both shapes
  // until the live shape is pinned in the go-live verification).
  const isError =
    json.Status === 1 ||
    (typeof json.Status === 'object' && json.Status?.IsError === true);
  if (isError) throw new SumitDeclinedError();

  const authNumber = json.Data?.Payment?.AuthNumber;
  if (!authNumber) {
    throw new SumitNetworkError('אישור התפיסה לא התקבל ממערכת');
  }
  return { authNumber, cardToken: json.Data?.CreditCard_Token ?? null };
}
