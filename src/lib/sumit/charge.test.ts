import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chargeSumit,
  SumitDeclinedError,
  SumitNetworkError,
  type SumitChargeParams,
} from '@/lib/sumit/charge';

// `charge.ts` begins with `import 'server-only'`, which throws outside Next's RSC context.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

// chargeSumit is the package PURCHASE: one real charge (J4) on a card the customer typed into SUMIT's own form, which
// hands us a single-use token. The properties defended here:
//   - the amount SUMIT is asked for is exactly what the caller computed on the server;
//   - the body carries no VAT field (KALFA is an exempt dealer) and no CardTokenNotNeeded (the DEFAULT is what makes
//     SUMIT keep a reusable token, which an upgrade or a refund needs);
//   - a clear decline is told apart from "we do not know": an unknown outcome is NEVER reported as a decline, because
//     the money may have moved and a retry could charge twice.

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const REF = '11111111-1111-4111-8111-111111111111';

type SentBody = {
  Credentials: { CompanyID: number; APIKey: string };
  Customer: { ID?: number; Name?: string; EmailAddress?: string; ExternalIdentifier: string };
  Items: Array<{ Quantity: number; UnitPrice: number; Item: { Name: string }; Description: string }>;
  SingleUseToken: string;
  AutoCapture: boolean;
  PreventDocumentCreation: boolean;
  SendDocumentByEmail: boolean;
  DraftDocument: boolean;
} & Record<string, unknown>;

function params(over: Partial<SumitChargeParams> = {}): SumitChargeParams {
  return {
    companyId: 12345,
    apiKey: 'test-api-key',
    ogToken: 'og-token-abc',
    amount: '120.00',
    description: 'KALFA — חבילת אירוע',
    externalRef: REF,
    customerEmail: 'dana@example.com',
    customerName: 'דנה כהן',
    ...over,
  };
}

const goodPayment = {
  ID: 4242,
  ValidPayment: true,
  Status: '000',
  StatusDescription: 'מאושר (קוד 000)',
  AuthNumber: ' 0759469',
  PaymentMethod: {
    Type: 1,
    CreditCard_Token: 'tok-reusable',
    CreditCard_ExpirationMonth: 7,
    CreditCard_ExpirationYear: 2031,
    CreditCard_LastDigits: '9183',
    CreditCard_CardMask: 'XXXXXXXXXXXX9183',
    CreditCard_CitizenID: '316125434',
  },
};

function answer(data: unknown, status: unknown = 0) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ Status: status, Data: data }) });
}
function goodAnswer(over: Record<string, unknown> = {}) {
  answer({
    DocumentID: 77,
    DocumentNumber: 40106,
    DocumentDownloadURL: 'https://example.test/doc/77',
    CustomerID: 2127277236,
    Payment: goodPayment,
    ...over,
  });
}
function sent(): SentBody {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(init?.body as string) as SentBody;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('chargeSumit — a confirmed charge', () => {
  it('returns every reference the ledger needs, and the card SUMIT kept for later charges', async () => {
    goodAnswer();
    const result = await chargeSumit(params());
    expect(result).toEqual({
      documentId: 77,
      documentNumber: 40106,
      documentUrl: 'https://example.test/doc/77',
      paymentId: 4242,
      authNumber: '0759469',
      status: '000',
      statusDescription: 'מאושר (קוד 000)',
      sumitCustomerId: 2127277236,
      paymentMethod: goodPayment.PaymentMethod,
    });
  });

  it('tolerates a charge that returns no reusable card: the money is confirmed, the card is simply absent', async () => {
    goodAnswer({ Payment: { ...goodPayment, PaymentMethod: null } });
    const result = await chargeSumit(params());
    expect(result.paymentMethod).toBeNull();
    expect(result.documentId).toBe(77);
  });
});

describe('chargeSumit — the request', () => {
  it('is one real charge on the single-use token, for the amount given, with a real receipt', async () => {
    goodAnswer();
    await chargeSumit(params());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sumit.co.il/billing/payments/charge/');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeDefined();
    expect(sent()).toMatchObject({
      Credentials: { CompanyID: 12345, APIKey: 'test-api-key' },
      SingleUseToken: 'og-token-abc',
      AutoCapture: true,
      PreventDocumentCreation: false,
      DraftDocument: false,
      SendDocumentByEmail: true,
      Items: [{ Quantity: 1, UnitPrice: 120, Item: { Name: 'KALFA — חבילת אירוע' }, Description: 'KALFA — חבילת אירוע' }],
    });
  });

  it('sends NO VAT field and does NOT opt out of the reusable token (owner decision 2.9.2026; the default keeps the card)', async () => {
    goodAnswer();
    await chargeSumit(params());
    const body = sent();
    for (const field of ['VATIncluded', 'VATRate', 'CardTokenNotNeeded', 'AuthorizeAmount', 'CreditCardAuthNumber', 'SupportCredit']) {
      expect(field in body, field).toBe(false);
    }
  });

  it('identifies the customer: the known SUMIT customer number when there is one, our reference always', async () => {
    goodAnswer();
    await chargeSumit(params({ customerId: 2127277236 }));
    expect(sent().Customer).toEqual({
      ID: 2127277236,
      Name: 'דנה כהן',
      EmailAddress: 'dana@example.com',
      ExternalIdentifier: REF,
    });
  });

  it('without a known customer it sends no customer number — SUMIT opens one and tells us its number', async () => {
    goodAnswer();
    await chargeSumit(params({ customerId: null }));
    expect('ID' in sent().Customer).toBe(false);
  });

  it('does not ask SUMIT to email a receipt to an empty address', async () => {
    goodAnswer();
    await chargeSumit(params({ customerEmail: '' }));
    expect(sent().SendDocumentByEmail).toBe(false);
    expect('EmailAddress' in sent().Customer).toBe(false);
  });

  it.each(['0', '-5', 'abc', '', 'NaN'])('refuses the amount %j before any request leaves the server', async (amount) => {
    await expect(chargeSumit(params({ amount }))).rejects.toThrow('סכום החיוב אינו תקין');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('chargeSumit — a decline is certain; everything else is not', () => {
  it('a business error from SUMIT is a decline', async () => {
    answer(null, 1);
    await expect(chargeSumit(params())).rejects.toBeInstanceOf(SumitDeclinedError);
  });

  it('a well-formed request whose PAYMENT the issuer refused (Status 0, ValidPayment false) is a decline', async () => {
    answer({ DocumentID: null, Payment: { ...goodPayment, ValidPayment: false, Status: '004' } });
    await expect(chargeSumit(params())).rejects.toBeInstanceOf(SumitDeclinedError);
  });

  it('a network failure is "we do not know", never a decline — and the thrown text carries no secret', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED og-token-abc test-api-key'));
    const err = await chargeSumit(params()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SumitNetworkError);
    expect(String((err as Error).message)).not.toContain('og-token-abc');
    expect(String((err as Error).message)).not.toContain('test-api-key');
  });

  it('our own timeout is "we do not know" too: the charge may have gone through', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(chargeSumit(params())).rejects.toBeInstanceOf(SumitNetworkError);
  });

  it('a non-2xx answer is unknown', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(chargeSumit(params())).rejects.toBeInstanceOf(SumitNetworkError);
  });

  it('a body that is not JSON is unknown', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } });
    await expect(chargeSumit(params())).rejects.toBeInstanceOf(SumitNetworkError);
  });

  it.each([
    ['a technical error status', 2, { DocumentID: 77, Payment: goodPayment }],
    ['an unrecognised status', 'Banana', { DocumentID: 77, Payment: goodPayment }],
    ['success without a payment verdict', 0, { DocumentID: 77, Payment: { ...goodPayment, ValidPayment: null } }],
    ['a valid payment with no receipt', 0, { DocumentID: null, Payment: goodPayment }],
    ['success with no payment at all', 0, { DocumentID: 77 }],
  ])('%s is unknown — review, never a silent success and never a decline', async (_label, status, data) => {
    answer(data, status);
    await expect(chargeSumit(params())).rejects.toBeInstanceOf(SumitNetworkError);
  });
});
