import 'server-only';

const SUMIT_CHARGE_URL = 'https://api.sumit.co.il/billing/payments/charge/';

export interface SumitChargeParams {
  companyId: number;         // SUMIT CompanyID — from admin-managed DB config
  apiKey: string;            // SUMIT private API key — from admin-managed DB config (server-only)
  ogToken: string;
  totalWithVat: string;      // Postgres numeric as string — no float distortion
  vatRate: string;
  paymentAttemptRef: string; // UUID → Customer.ExternalIdentifier for reconciliation
  customerEmail: string;     // empty string → SendDocumentByEmail: false (guard in caller)
}

export interface SumitChargeResult {
  documentId: number;
}

export class SumitNetworkError extends Error {
  readonly isNetworkError = true;
  constructor(msg: string) { super(msg); this.name = 'SumitNetworkError'; }
}

// Thrown ONLY when SUMIT returns Status.IsError=true in a 2xx response —
// the only case where SUMIT has definitively declined the charge with no ambiguity.
// Any other error type (network, parse failure, missing DocumentID, unexpected throw)
// is treated as unknown outcome → payment_review, not failed.
export class SumitDeclinedError extends Error {
  constructor() { super('payment_declined'); this.name = 'SumitDeclinedError'; }
}

export async function chargeSumit(params: SumitChargeParams): Promise<SumitChargeResult> {
  const body = {
    Credentials: { CompanyID: params.companyId, APIKey: params.apiKey },
    Customer: {
      EmailAddress: params.customerEmail || undefined,
      ExternalIdentifier: params.paymentAttemptRef,  // reconciliation anchor
    },
    SingleUseToken: params.ogToken,
    VATIncluded: true,
    VATRate: parseFloat(params.vatRate),
    Items: [{
      Quantity: 1,
      UnitPrice: parseFloat(params.totalWithVat),
      Description: 'KALFA — שירות ניהול אירועים',
    }],
    // Only send document by email when a valid address exists.
    // An empty string would cause SUMIT to error or silently drop the receipt.
    SendDocumentByEmail: !!params.customerEmail,
    DraftDocument: false,
    PreventDocumentCreation: false,
  };

  let res: Response;
  try {
    res = await fetch(SUMIT_CHARGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Network error: charge may or may not have reached SUMIT.
    // Caller must move to payment_review, not failed.
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }

  if (!res.ok) {
    // Any non-2xx: the request may have reached SUMIT (esp. 5xx). Treat as unknown.
    // Only IsError=true in a 2xx body is a definite decline (safe to retry).
    throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
  }

  type ChargeResponse = {
    Status?: { IsError?: boolean };
    UserErrorMessage?: string | null;
    Data?: { DocumentID?: number | null };
  };

  let json: ChargeResponse;
  try {
    json = (await res.json()) as ChargeResponse;
  } catch {
    // Got a response but can't parse — treat as unknown outcome.
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  if (json.Status?.IsError) {
    // Definitive SUMIT decline — the only case where failed + retry is safe.
    throw new SumitDeclinedError();
  }

  const documentId = json.Data?.DocumentID;
  if (!documentId) {
    // DocumentID missing in non-error response — unknown outcome.
    throw new SumitNetworkError('אישור תשלום לא התקבל ממערכת');
  }

  return { documentId };
}
