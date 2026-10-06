import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { probeSumitCharge } from './probe';

// A payment operation that ended in `review` means "SUMIT may or may not have charged". This probe asks SUMIT's payment
// list, read-only, whether a payment of that amount exists around that time — as a SUGGESTION for the admin who decides.
// It must never throw, never echo credentials, and never turn "could not ask" into "no payment".

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = { companyId: 7, apiKey: 'secret-key', recordedAt: '2026-10-05T10:00:00.000Z', amount: 120 };

type Page = { Payments?: unknown[]; HasNextPage?: boolean };
function reply(data: Page | null, status: unknown = 0) {
  return new Response(JSON.stringify({ Status: status, Data: data }), { status: 200 });
}
function stubPages(...pages: Array<Page | Response>) {
  const f = vi.fn(async () => {
    const next = pages.shift();
    if (next instanceof Response) return next;
    return reply(next ?? { Payments: [], HasNextPage: false });
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const payment = (over: Record<string, unknown> = {}) => ({
  ID: 111,
  CustomerID: 2127277236,
  Date: '2026-10-05T10:00:07+03:00',
  ValidPayment: true,
  Amount: 120,
  AuthNumber: ' 0759469',
  ...over,
});
const sentBody = (f: ReturnType<typeof stubPages>) =>
  JSON.parse(String((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)) as Record<string, unknown>;

describe('probeSumitCharge — the request', () => {
  it('asks the payment list for VALID payments in a day either side of the recorded time', async () => {
    const f = stubPages({ Payments: [], HasNextPage: false });
    await probeSumitCharge(BASE);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; signal?: AbortSignal }];
    expect(url).toBe('https://api.sumit.co.il/billing/payments/list/');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeDefined();
    expect(sentBody(f)).toMatchObject({
      Credentials: { CompanyID: 7, APIKey: 'secret-key' },
      Valid: true,
      StartIndex: 0,
      Date_From: '2026-10-04T10:00:00.000Z',
      Date_To: '2026-10-06T10:00:00.000Z',
    });
  });

  it('refuses a company id that is not a number, before any request', async () => {
    const f = stubPages();
    expect(await probeSumitCharge({ ...BASE, companyId: 'abc' })).toEqual({ kind: 'unavailable', reason: 'credentials' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('probeSumitCharge — matching', () => {
  it('finds a payment of the same amount (and customer, when we know it) and returns only safe fields', async () => {
    stubPages({ Payments: [payment(), payment({ ID: 222, Amount: 50 })], HasNextPage: false });
    const result = await probeSumitCharge({ ...BASE, customerId: 2127277236 });
    expect(result).toEqual({
      kind: 'found',
      matches: [{ paymentId: 111, date: '2026-10-05T10:00:07+03:00', amount: 120, authNumber: '0759469', customerId: 2127277236 }],
    });
  });

  it("another customer's payment of the same amount is not a match when the customer is known", async () => {
    stubPages({ Payments: [payment({ CustomerID: 999 })], HasNextPage: false });
    expect(await probeSumitCharge({ ...BASE, customerId: 2127277236 })).toEqual({ kind: 'not_found' });
  });

  it('without a known customer the amount alone decides, and every candidate is returned for the admin to judge', async () => {
    stubPages({ Payments: [payment({ ID: 1, CustomerID: 5 }), payment({ ID: 2, CustomerID: 6 })], HasNextPage: false });
    const result = await probeSumitCharge(BASE);
    expect(result.kind === 'found' && result.matches.map((m) => m.paymentId)).toEqual([1, 2]);
  });

  it('a payment that SUMIT itself marks invalid is not a charge', async () => {
    stubPages({ Payments: [payment({ ValidPayment: false })], HasNextPage: false });
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'not_found' });
  });

  it('compares money to the agora, not with ===', async () => {
    stubPages({ Payments: [payment({ Amount: 120.004 })], HasNextPage: false });
    expect((await probeSumitCharge(BASE)).kind).toBe('found');
    stubPages({ Payments: [payment({ Amount: 120.02 })], HasNextPage: false });
    expect((await probeSumitCharge(BASE)).kind).toBe('not_found');
  });

  it('an empty list is "not found"', async () => {
    stubPages({ Payments: [], HasNextPage: false });
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'not_found' });
  });
});

describe('probeSumitCharge — paging', () => {
  it('follows HasNextPage, advancing StartIndex by what it received', async () => {
    const f = stubPages(
      { Payments: [payment({ ID: 1, Amount: 5 }), payment({ ID: 2, Amount: 6 })], HasNextPage: true },
      { Payments: [payment({ ID: 3 })], HasNextPage: false },
    );
    const result = await probeSumitCharge(BASE);
    expect(f).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((f.mock.calls[1] as unknown as [string, { body: string }])[1].body)) as { StartIndex: number };
    expect(second.StartIndex).toBe(2);
    expect(result.kind === 'found' && result.matches.map((m) => m.paymentId)).toEqual([3]);
  });

  it('gives up honestly after too many pages instead of looping — and says "unavailable", not "not found"', async () => {
    const endless = vi.fn(async () => reply({ Payments: [payment({ Amount: 1 })], HasNextPage: true }));
    vi.stubGlobal('fetch', endless);
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'unavailable', reason: 'too_many_pages' });
    expect(endless.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('a page that claims there is more but returns nothing stops the loop', async () => {
    const f = stubPages({ Payments: [], HasNextPage: true });
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'not_found' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('probeSumitCharge — cannot ask is never "no payment"', () => {
  it('a business error is "credentials"; a technical one is "provider_error"', async () => {
    stubPages(reply(null, 1));
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'unavailable', reason: 'credentials' });
    stubPages(reply(null, 2));
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'unavailable', reason: 'provider_error' });
  });

  it('a status it does not recognise is "unexpected_response"', async () => {
    stubPages(reply({ Payments: [] }, 'Banana'));
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'unavailable', reason: 'unexpected_response' });
  });

  it('a non-2xx answer, a network failure and a body that is not JSON are all "unavailable"', async () => {
    stubPages(new Response('nope', { status: 502 }));
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'unavailable', reason: 'unreachable' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED secret-key'); }));
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'unavailable', reason: 'unreachable' });
    stubPages(new Response('<html>', { status: 200 }));
    expect(await probeSumitCharge(BASE)).toEqual({ kind: 'unavailable', reason: 'unexpected_response' });
  });

  it('never returns the API key, even when the underlying error text contains it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED secret-key'); }));
    expect(JSON.stringify(await probeSumitCharge(BASE))).not.toContain('secret-key');
  });
});
