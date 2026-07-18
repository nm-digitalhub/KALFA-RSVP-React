import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { captureHeldCardSumit } from './capture';
import { SumitDeclinedError, SumitNetworkError } from './charge';

const base = {
  companyId: 1,
  apiKey: 'k',
  cardToken: 'tok-abc',
  expMonth: 7,
  expYear: 2031,
  citizenId: '316125434',
  externalRef: 'kalfa-campaign-c1',
  amount: '4',
  customerEmail: '',
};

// A fully-approved SUMIT charge response (Status 0 + ValidPayment true + receipt).
const ok = {
  Status: 0,
  Data: {
    DocumentID: 555,
    DocumentNumber: 40103,
    DocumentDownloadURL: 'https://pay.sumit.co.il/x?download=555',
    Payment: { ID: 777, AuthNumber: '0692601', ValidPayment: true },
  },
};

afterEach(() => vi.restoreAllMocks());

describe('captureHeldCardSumit', () => {
  it('charges the saved CreditCard_Token + expiry + CitizenID, no VATRate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ok,
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await captureHeldCardSumit(base);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.PaymentMethod.CreditCard_Token).toBe('tok-abc');
    expect(body.PaymentMethod.CreditCard_ExpirationMonth).toBe(7);
    expect(body.PaymentMethod.CreditCard_ExpirationYear).toBe(2031);
    expect(body.PaymentMethod.CreditCard_CitizenID).toBe('316125434');
    expect(body.PaymentMethod.Type).toBe(1);
    // No explicit VATRate (company default balances the document).
    expect(body.VATRate).toBeUndefined();
    // No CreditCardAuthNumber (a fresh token charge, not an auth capture).
    expect(body.CreditCardAuthNumber).toBeUndefined();
    expect(body.AutoCapture).toBe(true);
    expect(body.Items[0].UnitPrice).toBe(4);
    expect(body.Items[0].Item.Name).toBeTruthy();
    // No customerName given → omitted (SUMIT then prints "כרטיס ללא שם").
    expect(body.Customer.Name).toBeUndefined();
    // The full response is captured.
    expect(r.documentId).toBe(555);
    expect(r.documentNumber).toBe(40103);
    expect(r.documentUrl).toContain('download=555');
    expect(r.authNumber).toBe('0692601');
    expect(r.paymentId).toBe(777);
  });

  it('passes customerName through to Customer.Name (the receipt "לכבוד" line)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ok,
    });
    vi.stubGlobal('fetch', fetchMock);

    await captureHeldCardSumit({ ...base, customerName: 'ישראל ישראלי' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.Customer.Name).toBe('ישראל ישראלי');
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

  it('throws SumitDeclinedError when the issuer declines (Status 0 but ValidPayment false, e.g. 004)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Status: 0,
          Data: {
            DocumentID: null,
            Payment: { Status: '004', ValidPayment: false },
          },
        }),
      }),
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
        json: async () => ({
          Status: 0,
          Data: { Payment: { ValidPayment: true } },
        }),
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
