import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chargeSumit,
  SumitDeclinedError,
  SumitNetworkError,
  type SumitChargeParams,
} from '@/lib/sumit/charge';

// `charge.ts` begins with `import 'server-only'`, which throws outside Next's
// RSC context. Vitest does not set that export condition.
vi.mock('server-only', () => ({}));

// Untyped fetch mock: a fully-typed `fetch` signature would force every
// mockResolvedValue to be a complete Response. We feed partial { ok, json }
// shapes, which is all the SUT reads.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const PAYMENT_ATTEMPT_REF = '11111111-1111-4111-8111-111111111111';

// The exact shape charge.ts serialises into the request body — used to assert
// the reconciliation anchor and the email guard without a loose `any` cast.
type SumitRequestBody = {
  Credentials: { CompanyID: number; APIKey: string };
  Customer: { EmailAddress?: string; ExternalIdentifier: string };
  SingleUseToken: string;
  VATIncluded: boolean;
  VATRate: number;
  Items: Array<{ Quantity: number; UnitPrice: number; Description: string }>;
  SendDocumentByEmail: boolean;
  DraftDocument: boolean;
  PreventDocumentCreation: boolean;
};

function sampleParams(overrides: Partial<SumitChargeParams> = {}): SumitChargeParams {
  return {
    companyId: 12345,
    apiKey: 'test-api-key',
    ogToken: 'og-token-abc',
    totalWithVat: '1170.00',
    vatRate: '0.17',
    paymentAttemptRef: PAYMENT_ATTEMPT_REF,
    customerEmail: 'guest@example.com',
    ...overrides,
  };
}

// Reads the body of the first fetch call as the typed SUMIT request payload.
function sentBody(): SumitRequestBody {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(init?.body as string) as SumitRequestBody;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('chargeSumit', () => {
  it('returns the DocumentID on a successful charge', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ Status: { IsError: false }, Data: { DocumentID: 99 } }),
    });

    await expect(chargeSumit(sampleParams())).resolves.toEqual({ documentId: 99 });
  });

  it('throws SumitDeclinedError when Status.IsError is true in a 2xx body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ Status: { IsError: true }, UserErrorMessage: 'declined' }),
    });

    await expect(chargeSumit(sampleParams())).rejects.toBeInstanceOf(SumitDeclinedError);
  });

  it('throws SumitNetworkError when fetch rejects (network failure)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(chargeSumit(sampleParams())).rejects.toBeInstanceOf(SumitNetworkError);
  });

  it('throws SumitNetworkError on a non-2xx HTTP response (500)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(chargeSumit(sampleParams())).rejects.toBeInstanceOf(SumitNetworkError);
  });

  it('throws SumitNetworkError when the 2xx body is malformed JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    await expect(chargeSumit(sampleParams())).rejects.toBeInstanceOf(SumitNetworkError);
  });

  it('throws SumitNetworkError when DocumentID is null in a non-error response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ Status: { IsError: false }, Data: { DocumentID: null } }),
    });

    await expect(chargeSumit(sampleParams())).rejects.toBeInstanceOf(SumitNetworkError);
  });

  it('sends paymentAttemptRef as Customer.ExternalIdentifier', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ Status: { IsError: false }, Data: { DocumentID: 99 } }),
    });

    await chargeSumit(sampleParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody().Customer.ExternalIdentifier).toBe(PAYMENT_ATTEMPT_REF);
  });

  it('sends the credentials passed in params (not from env)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ Status: { IsError: false }, Data: { DocumentID: 99 } }),
    });

    await chargeSumit(sampleParams({ companyId: 999, apiKey: 'k-from-db' }));

    expect(sentBody().Credentials).toEqual({ CompanyID: 999, APIKey: 'k-from-db' });
  });

  it('sets SendDocumentByEmail to false when the customer email is empty', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ Status: { IsError: false }, Data: { DocumentID: 99 } }),
    });

    await chargeSumit(sampleParams({ customerEmail: '' }));

    expect(sentBody().SendDocumentByEmail).toBe(false);
  });
});
