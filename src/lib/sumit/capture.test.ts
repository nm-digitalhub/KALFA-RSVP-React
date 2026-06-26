import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { captureHeldCardSumit } from './capture';
import { SumitDeclinedError, SumitNetworkError } from './charge';

const base = {
  companyId: 1,
  apiKey: 'k',
  customerRef: 'kalfa-campaign-c1',
  amount: '4',
  vatRate: '18',
  customerEmail: '',
};

afterEach(() => vi.restoreAllMocks());

describe('captureHeldCardSumit', () => {
  it('charges the saved Customer with NO token / NO PaymentMethod and AutoCapture', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Status: 0, Data: { DocumentID: 555 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await captureHeldCardSumit(base);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.Customer.ExternalIdentifier).toBe('kalfa-campaign-c1');
    expect(body.SingleUseToken).toBeUndefined();
    expect(body.PaymentMethod).toBeUndefined();
    expect(body.AutoCapture).toBe(true);
    expect(body.Items[0].UnitPrice).toBe(4);
    expect(body.Items[0].Item.Name).toBeTruthy();
    expect(r.documentId).toBe(555);
  });

  it('throws SumitDeclinedError on a business decline (Status 1)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Status: 1 }) }),
    );
    await expect(captureHeldCardSumit(base)).rejects.toBeInstanceOf(
      SumitDeclinedError,
    );
  });

  it('throws SumitNetworkError when DocumentID is missing (ambiguous)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ Status: 0, Data: {} }),
      }),
    );
    await expect(captureHeldCardSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });

  it('throws SumitNetworkError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(captureHeldCardSumit(base)).rejects.toBeInstanceOf(
      SumitNetworkError,
    );
  });
});
