import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { chargeRaw } from '@/lib/sumit/raw-charge';

function sentBodyOf(f: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const opts = f.mock.calls[0][1] as RequestInit;
  return JSON.parse(opts.body as string);
}

describe('chargeRaw', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a J5 body (AutoCapture=false) with AuthorizeAmount and omits CardTokenNotNeeded by default (saves token)', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ Status: { IsError: false }, Data: { DocumentID: 123 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', f);

    const res = await chargeRaw({
      companyId: 7,
      apiKey: 'secret-key',
      ogToken: 'tok',
      amount: '1',
      vatRate: '18',
      autoCapture: false,
      authorizeAmount: '50',
      externalId: 'poc-1',
    });

    const body = sentBodyOf(f);
    expect(body.AutoCapture).toBe(false);
    expect(body.AuthorizeAmount).toBe(50);
    expect((body.Items as Array<{ UnitPrice: number }>)[0].UnitPrice).toBe(1);
    expect(body.VATRate).toBe(18);
    expect('CardTokenNotNeeded' in body).toBe(false); // default → SUMIT saves the token
    expect(res.httpStatus).toBe(200);
    expect(res.raw).toMatchObject({ Data: { DocumentID: 123 } });
    // The API key is never surfaced in the echoed body.
    expect(res.sentBody.Credentials).toEqual({ CompanyID: 7, APIKey: '***' });
  });

  it('sets CardTokenNotNeeded=true when requested, with AutoCapture=true (J4)', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ Data: { DocumentID: 9 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', f);

    await chargeRaw({
      companyId: 1,
      apiKey: 'k',
      ogToken: 't',
      amount: '2.5',
      vatRate: '18',
      autoCapture: true,
      cardTokenNotNeeded: true,
      externalId: 'p',
    });

    const body = sentBodyOf(f);
    expect(body.AutoCapture).toBe(true);
    expect(body.CardTokenNotNeeded).toBe(true);
  });

  it('uses SingleUseToken (and no PaymentMethod) for a new card', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ Data: { DocumentID: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', f);
    await chargeRaw({
      companyId: 1,
      apiKey: 'k',
      ogToken: 'og-123',
      amount: '1',
      vatRate: '18',
      autoCapture: false,
      externalId: 'p',
    });
    const body = sentBodyOf(f);
    expect(body.SingleUseToken).toBe('og-123');
    expect('PaymentMethod' in body).toBe(false);
  });

  it('uses PaymentMethod.CreditCard_Token (and no SingleUseToken) for a saved token', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ Data: { DocumentID: 2 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', f);
    await chargeRaw({
      companyId: 1,
      apiKey: 'k',
      savedCardToken: 'saved-abc',
      amount: '5',
      vatRate: '18',
      autoCapture: true,
      externalId: 'p',
    });
    const body = sentBodyOf(f);
    // SUMIT rejects a saved-token charge without Type ("Type should be set to
    // CreditCard or DirectDebit", Status 1 — verified live 2026-07-01), so the
    // PaymentMethod must carry Type:1 (CreditCard), mirroring capture.ts.
    expect(body.PaymentMethod).toEqual({
      CreditCard_Token: 'saved-abc',
      Type: 1,
    });
    expect('SingleUseToken' in body).toBe(false);
  });

  it('returns raw text (not JSON) and ok=false on a non-JSON error response', async () => {
    const f = vi.fn(async () => new Response('plain error', { status: 500 }));
    vi.stubGlobal('fetch', f);

    const res = await chargeRaw({
      companyId: 1,
      apiKey: 'k',
      ogToken: 't',
      amount: '1',
      vatRate: '18',
      autoCapture: false,
      externalId: 'p',
    });

    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(500);
    expect(res.raw).toBe('plain error');
  });
});
