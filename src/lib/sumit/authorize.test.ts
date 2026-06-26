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

afterEach(() => vi.unstubAllGlobals());

describe('authorizeHoldSumit', () => {
  it('sends a J5 hold (AutoCapture:false, AuthorizeAmount=ceiling, Item.Name, PreventDocumentCreation) and returns AuthNumber + token', async () => {
    mockFetch(200, {
      Status: 0,
      Data: {
        Payment: { AuthNumber: 'A123', ValidPayment: true },
        CreditCard_Token: 'tok_9',
      },
    });

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

  it('throws SumitDeclinedError on a definitive decline (Status===1)', async () => {
    mockFetch(200, { Status: 1, UserErrorMessage: 'declined' });
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitDeclinedError,
    );
  });

  it('throws SumitNetworkError on a non-2xx (ambiguous outcome)', async () => {
    mockFetch(502, {});
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });

  it('throws SumitNetworkError when AuthNumber is missing in a non-error response', async () => {
    mockFetch(200, { Status: 0, Data: {} });
    await expect(authorizeHoldSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });
});
