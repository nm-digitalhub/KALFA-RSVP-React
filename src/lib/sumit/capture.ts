import 'server-only';

import { SumitDeclinedError, SumitNetworkError } from '@/lib/sumit/charge';

const SUMIT_CHARGE_URL = 'https://api.sumit.co.il/billing/payments/charge/';

export interface SumitCaptureParams {
  companyId: number; // SUMIT CompanyID — admin-managed DB config
  apiKey: string; // SUMIT private API key — server-only
  customerRef: string; // the hold's stable Customer.ExternalIdentifier
  amount: string; // Postgres numeric as string — no float distortion
  vatRate: string;
  customerEmail: string; // '' → SendDocumentByEmail:false
}

export interface SumitCaptureResult {
  documentId: number;
}

// Close-charge: charge the card the J5 hold already saved, WITHOUT re-entry. The
// only mechanism SUMIT accepts for this is referencing the same Customer
// (ExternalIdentifier) with PaymentMethod AND SingleUseToken BOTH omitted — the
// swagger's "leave empty to use the customer payment method". (Passing the raw
// CreditCard_Token was verified to fail.) AutoCapture:true = actually charge.
export async function captureHeldCardSumit(
  p: SumitCaptureParams,
): Promise<SumitCaptureResult> {
  const body = {
    Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
    Customer: {
      EmailAddress: p.customerEmail || undefined,
      ExternalIdentifier: p.customerRef, // recover the saved card via this anchor
    },
    VATIncluded: true,
    VATRate: parseFloat(p.vatRate),
    Items: [
      {
        Quantity: 1,
        UnitPrice: parseFloat(p.amount),
        // SUMIT requires the Item object (IncomeItem.Name), not just a Description.
        Item: { Name: 'KALFA — חיוב קמפיין' },
        Description: 'KALFA — חיוב קמפיין',
      },
    ],
    // NO SingleUseToken and NO PaymentMethod → charge the customer's saved method.
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
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }
  if (!res.ok) {
    throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
  }

  // Same Status envelope as authorize.ts: number 0/1/2, the enum string, or the
  // legacy { IsError } object. BusinessError(1) = definitive decline.
  type Resp = {
    Status?: number | string | { IsError?: boolean } | null;
    Data?: { DocumentID?: number | null } | null;
  };
  let json: Resp;
  try {
    json = (await res.json()) as Resp;
  } catch {
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  const status = json.Status;
  const businessError =
    status === 1 ||
    (typeof status === 'string' && /business|\(1\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === true);
  if (businessError) throw new SumitDeclinedError();

  const success =
    status === 0 ||
    (typeof status === 'string' && /success|\(0\)/i.test(status)) ||
    (typeof status === 'object' && status?.IsError === false);

  const documentId = json.Data?.DocumentID;
  // A TechnicalError(2) or any unrecognized status — even with a DocumentID — is
  // ambiguous → review, never a silent success.
  if (!success || !documentId) {
    throw new SumitNetworkError('אישור החיוב לא התקבל ממערכת');
  }
  return { documentId };
}
