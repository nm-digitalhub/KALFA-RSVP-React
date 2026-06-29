import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { authorizeHoldSumit } from './authorize';
import { SumitDeclinedError, SumitNetworkError } from './charge';

const base = {
  companyId: 1,
  apiKey: 'k',
  ogToken: 'og-1',
  ceiling: '1400.00',
  vatRate: '18',
  authRef: 'ref-1',
  customerEmail: '',
};

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

// A swagger-shaped success envelope: top-level Status enum + Data.Payment with
// ValidPayment/AuthNumber and the reusable token on Payment.PaymentMethod.
function okBody(over: Record<string, unknown> = {}) {
  return {
    Status: 0, // Success (0)
    Data: {
      Payment: {
        AuthNumber: 'A123',
        ValidPayment: true,
        PaymentMethod: { CreditCard_Token: 'tok_9' },
      },
    },
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('authorizeHoldSumit', () => {
  it('sends a J5 hold (AutoCapture:false, AuthorizeAmount=ceiling, Item.Name, PreventDocumentCreation) and returns AuthNumber + token', async () => {
    mockFetch(200, okBody());

    const r = await authorizeHoldSumit(base);

    const sent = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent.AutoCapture).toBe(false);
    expect(sent.AuthorizeAmount).toBe(1400);
    expect(sent.PreventDocumentCreation).toBe(true);
    expect(sent.Items[0].Item.Name).toBeTruthy();
    expect(sent.SingleUseToken).toBe('og-1');
    expect(r.authNumber).toBe('A123');
    expect(r.cardToken).toBe('tok_9');
  });

  it('accepts the enum-string Status form ("Success (0)")', async () => {
    mockFetch(200, okBody({ Status: 'Success (0)' }));
    await expect(authorizeHoldSumit(base)).resolves.toMatchObject({
      authNumber: 'A123',
    });
  });

  it('throws SumitDeclinedError on a BusinessError (numeric Status 1)', async () => {
    mockFetch(200, { Status: 1, Data: { Payment: {} } });
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitDeclinedError,
    );
  });

  it('throws SumitDeclinedError on a BusinessError (enum string)', async () => {
    mockFetch(200, { Status: 'BusinessError (1)', Data: { Payment: {} } });
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitDeclinedError,
    );
  });

  it('throws SumitNetworkError on a TechnicalError (Status 2) — ambiguous, never authorized', async () => {
    mockFetch(200, {
      Status: 2,
      Data: { Payment: { AuthNumber: 'A1', ValidPayment: true } },
    });
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });

  it('throws SumitNetworkError when ValidPayment is false', async () => {
    mockFetch(200, okBody({ Data: { Payment: { AuthNumber: 'A1', ValidPayment: false } } }));
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });

  it('throws SumitNetworkError when ValidPayment is undefined (Status 0 + AuthNumber) — ambiguous, never silent-authorized', async () => {
    mockFetch(200, { Status: 0, Data: { Payment: { AuthNumber: 'A1' } } });
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });

  it('throws SumitNetworkError when AuthNumber is missing in a success response', async () => {
    mockFetch(200, { Status: 0, Data: { Payment: { ValidPayment: true } } });
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });

  it('throws SumitNetworkError on a non-2xx (ambiguous outcome)', async () => {
    mockFetch(502, {});
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });
});
