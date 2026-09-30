import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import type { components } from '@/lib/sumit/types.generated';

const SUMIT_CHARGE_URL = 'https://api.sumit.co.il/billing/payments/charge/';

// The /billing/payments/charge/ request body, keyed by SUMIT's own swagger
// (types.generated.ts) so a misspelled or invented field fails `tsc`. Every
// module that posts to this endpoint types its body with
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

// Thrown only for a DEFINITIVE decline in a 2xx response: SUMIT refused the
// request (chargeSumit: Status.IsError; capture.ts/authorize.ts: a BusinessError
// status) or the issuer refused the payment (Data.Payment.ValidPayment === false,
// e.g. code 004). No money moved on that request.
// Any other error type (network, parse failure, missing DocumentID, unexpected throw)
// is treated as unknown outcome → review, not failed.
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
  } satisfies SumitChargeRequestBody;

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
    // Fail-safe ops alert (non-throwing, no PII — no email/token/amount). NOT
    // fired for SumitDeclinedError: a definite decline is a business outcome.
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: 'network', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
  }

  if (!res.ok) {
    // Any non-2xx: the request may have reached SUMIT (esp. 5xx). Treat as unknown.
    // Only IsError=true in a 2xx body is a definite decline (safe to retry).
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: `http_${res.status}`, source: 'sumit', category: 'send_health' });
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
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: 'invalid_response', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום');
  }

  if (json.Status?.IsError) {
    // Definitive SUMIT decline — the only case where failed + retry is safe.
    throw new SumitDeclinedError();
  }

  const documentId = json.Data?.DocumentID;
  if (!documentId) {
    // DocumentID missing in non-error response — unknown outcome.
    void sendSlackAlert({ level: 'warn', title: 'SUMIT charge failed', detail: 'missing_document_id', source: 'sumit', category: 'send_health' });
    throw new SumitNetworkError('אישור תשלום לא התקבל ממערכת');
  }

  return { documentId };
}
