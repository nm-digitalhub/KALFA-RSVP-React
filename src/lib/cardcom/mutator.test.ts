import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CardcomError, cardcomFetch } from './mutator';

// The mutator is the one place every generated CardCom operation goes through. It enforces the timeout and turns every
// way a call can go wrong into a typed CardcomError that says whether money MAY have moved. fetch is stubbed: nothing
// here touches the network.

const SECRET = 'API-PASSWORD-SECRET-123';
const URL_OK = 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult';
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({ TerminalNumber: 1000, ApiName: 'x', ApiPassword: SECRET, ...extra });

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
function stubFetch(answer: (init: RequestInit) => Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(init);
  });
}
const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const neverAnswers = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));

async function failure(promise: Promise<unknown>): Promise<CardcomError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof CardcomError) return e;
    throw new Error(`expected a CardcomError, got ${String(e)}`);
  }
  throw new Error('expected a failure, the call succeeded');
}
const leaks = (e: CardcomError) =>
  [e.message, String(e), JSON.stringify(e), e.stack ?? '', String((e as { cause?: unknown }).cause ?? '')].some(
    (text) => text.includes(SECRET) || text.includes('secret-detail'),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cardcomFetch', () => {
  it('POSTs the JSON body it was given, unchanged, with no caching', async () => {
    stubFetch(async () => json({ ResponseCode: 0 }));
    const sent = body({ LowProfileId: 'abc' });
    await cardcomFetch(URL_OK, { method: 'POST', body: sent });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_OK);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe(sent);
    expect(calls[0].init.cache).toBe('no-store');
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('application/json');
  });

  it('resolves with the parsed body, and does NOT judge ResponseCode: a declined payment is an answer, not an error', async () => {
    stubFetch(async () => json({ ResponseCode: 5033, Description: 'declined' }));
    await expect(cardcomFetch(URL_OK, { method: 'POST', body: body() })).resolves.toEqual({ ResponseCode: 5033, Description: 'declined' });
  });

  it('gives up after timeoutMs, and says the outcome is unknown', async () => {
    stubFetch(neverAnswers);
    const e = await failure(cardcomFetch(URL_OK, { method: 'POST', body: body(), cardcom: { timeoutMs: 30 } }));
    expect(e.kind).toBe('unreachable');
    expect(e.outcomeUnknown).toBe(true);
    expect(leaks(e)).toBe(false);
  });

  it('defaults to a 5 second timeout (the documented limit for GetLpResult)', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    stubFetch(async () => json({ ResponseCode: 0 }));
    await cardcomFetch(URL_OK, { method: 'POST', body: body() });
    expect(spy).toHaveBeenCalledWith(5_000);
    spy.mockRestore();
  });

  it('honours the abort signal the caller passed, long before the timeout', async () => {
    stubFetch(neverAnswers);
    const caller = new AbortController();
    const pending = failure(cardcomFetch(URL_OK, { method: 'POST', body: body(), cardcom: { timeoutMs: 400 }, signal: caller.signal }));
    setTimeout(() => caller.abort(), 10);
    expect((await pending).kind).toBe('unreachable');
  });

  it('a network failure is "unreachable" with the outcome unknown, and never repeats the original message', async () => {
    stubFetch(async () => { throw new Error(`ECONNRESET ${SECRET} secret-detail`); });
    const e = await failure(cardcomFetch(URL_OK, { method: 'POST', body: body() }));
    expect(e.kind).toBe('unreachable');
    expect(e.outcomeUnknown).toBe(true);
    expect(leaks(e)).toBe(false);
  });

  it('a 4xx is a refusal of the request: nothing happened', async () => {
    stubFetch(async () => json({ Message: 'Invalid username' }, { status: 401 }));
    const e = await failure(cardcomFetch(URL_OK, { method: 'POST', body: body() }));
    expect(e.kind).toBe('http_error');
    expect(e.httpStatus).toBe(401);
    expect(e.outcomeUnknown).toBe(false);
  });

  it('a 5xx may have been processed: outcome unknown', async () => {
    stubFetch(async () => new Response('boom', { status: 502 }));
    const e = await failure(cardcomFetch(URL_OK, { method: 'POST', body: body() }));
    expect(e.kind).toBe('http_error');
    expect(e.httpStatus).toBe(502);
    expect(e.outcomeUnknown).toBe(true);
  });

  it('a 200 that is not JSON is "bad_body", outcome unknown', async () => {
    stubFetch(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const e = await failure(cardcomFetch(URL_OK, { method: 'POST', body: body() }));
    expect(e.kind).toBe('bad_body');
    expect(e.outcomeUnknown).toBe(true);
  });

  it('a JSON body that is not an object is "bad_body"', async () => {
    stubFetch(async () => json([1, 2, 3]));
    expect((await failure(cardcomFetch(URL_OK, { method: 'POST', body: body() }))).kind).toBe('bad_body');
  });

  it('refuses to send anything but a string body, before leaving the process', async () => {
    stubFetch(async () => json({}));
    const e = await failure(cardcomFetch(URL_OK, { method: 'POST' }));
    expect(e.kind).toBe('invalid_request');
    expect(e.outcomeUnknown).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
