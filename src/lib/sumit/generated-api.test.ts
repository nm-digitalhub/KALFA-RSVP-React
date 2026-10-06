import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { accountingDocumentsGetPDF, billingPaymentsCharge, creditGuyVaultTokenizeSingleUse } from './generated/api';
import { AccountingTypedDocumentType, OfficeGuyAppsBillingMVCAPITypedPaymentMethodType } from './generated/api.schemas';
import { SumitError, type SumitCallOptions } from './mutator';

// The generated client (npm run sumit:gen -> src/lib/sumit/generated) run through the real mutator, with fetch stubbed.
// This pins what the generator + transformer + mutator add up to: the right URL and body, JSON, credentials added once.

const sumit: SumitCallOptions = { creds: { companyId: 4242, apiKey: 'APIKEY-SECRET-123' } };
let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(answer: () => Response) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  });
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generated SUMIT client', () => {
  it('charges through the mutator: right URL, JSON, the request fields, and the credentials added once', async () => {
    stubFetch(() => json({ Status: 0, Data: { DocumentID: 7 } }));
    const result = await billingPaymentsCharge(
      { Customer: { Name: 'x' }, Items: [], PaymentMethod: { Type: OfficeGuyAppsBillingMVCAPITypedPaymentMethodType.CreditCard } },
      { sumit },
    );
    expect(result.Data?.DocumentID).toBe(7);
    expect(calls[0].url).toBe('https://api.sumit.co.il/billing/payments/charge/');
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Customer: { Name: 'x' },
      Items: [],
      PaymentMethod: { Type: 1 },
      Credentials: { CompanyID: 4242, APIKey: 'APIKEY-SECRET-123' },
    });
  });

  it('does not accept Credentials as part of a request any more', async () => {
    stubFetch(() => json({ Status: 0 }));
    // @ts-expect-error the credentials belong to the mutator, not to the caller
    await billingPaymentsCharge({ Customer: {}, Items: [], Credentials: { CompanyID: 1, APIKey: 'x' } }, { sumit });
  });

  it('names the numeric enums the way SUMIT\'s documentation does', () => {
    expect(AccountingTypedDocumentType.Order).toBe(8);
    expect(AccountingTypedDocumentType.ProformaInvoice).toBe(3);
    expect(OfficeGuyAppsBillingMVCAPITypedPaymentMethodType.CreditCard).toBe(1);
  });

  it('downloads a document as a PDF Blob with the document type sent as a number', async () => {
    stubFetch(() => new Response(new TextEncoder().encode('%PDF-1.4 x'), { headers: { 'content-type': 'application/pdf' } }));
    const pdf = await accountingDocumentsGetPDF(
      { DocumentType: AccountingTypedDocumentType.Order, DocumentNumber: 1001, Original: false },
      { sumit },
    );
    expect(pdf).toBeInstanceOf(Blob);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ DocumentType: 8, DocumentNumber: 1001, Original: false });
  });

  it('turns a missing document (200 + JSON error) into a definitive refusal', async () => {
    stubFetch(() => json({ Data: null, Status: 1, UserErrorMessage: 'Document not found: 1' }));
    const failure = await accountingDocumentsGetPDF({ DocumentID: 1, Original: false }, { sumit }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SumitError);
    expect(failure).toMatchObject({ kind: 'rejected', outcomeUnknown: false });
  });

  it('refuses the multipart operations instead of sending a body SUMIT would not understand', async () => {
    stubFetch(() => json({ Status: 0 }));
    const failure = await creditGuyVaultTokenizeSingleUse(
      { 'Credentials.CompanyID': 1, 'Credentials.APIPublicKey': 'k', CardNumber: '0000', ExpirationMonth: 1, ExpirationYear: 2030 },
      { sumit },
    ).catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });
});
