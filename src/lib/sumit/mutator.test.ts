import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { SumitError, sumitFetch, sumitFetchPdf, type SumitCallOptions } from './mutator';

// The mutator is the one place every generated SUMIT operation goes through. It adds the credentials, enforces the
// timeout, and turns every way a call can go wrong into a typed SumitError that says whether money MAY have moved.
// fetch is stubbed: nothing here touches the network.

const SECRET = 'APIKEY-SECRET-123';
const sumit: SumitCallOptions = { creds: { companyId: 4242, apiKey: SECRET } };
const URL_OK = 'https://api.sumit.co.il/billing/payments/charge/';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

function stubFetch(answer: (init: RequestInit) => Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(init);
  });
}
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const bytes = (text: string, type = 'application/pdf') =>
  new Response(new TextEncoder().encode(text), { headers: { 'content-type': type } });
// A body that starts fine and then fails, with a detail that must never reach the caller.
const failingBody = (type: string) =>
  new Response(
    new ReadableStream({
      start: (c) => c.enqueue(new TextEncoder().encode('%PDF-1.4')),
      pull: () => {
        throw new Error('socket hang up secret-detail');
      },
    }),
    { headers: { 'content-type': type } },
  );
const neverAnswers = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
const body = (value: unknown = {}) => JSON.stringify(value);

async function failure(promise: Promise<unknown>): Promise<SumitError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof SumitError) return e;
    throw new Error(`expected a SumitError, got ${String(e)}`);
  }
  throw new Error('expected a failure, the call succeeded');
}
const leaks = (e: SumitError) =>
  [e.message, String(e), JSON.stringify(e), e.stack ?? '', String((e as { cause?: unknown }).cause ?? '')].some(
    (text) => text.includes(SECRET) || text.includes('secret-detail'),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sumitFetch: the request', () => {
  it('posts JSON with the credentials added to the generated body, and nothing cached', async () => {
    stubFetch(async () => json({ Status: 0, Data: { DocumentID: 7 } }));
    const result = await sumitFetch<{ Data: { DocumentID: number } }>(URL_OK, { body: body({ Customer: { Name: 'x' } }), sumit });
    expect(result.Data.DocumentID).toBe(7);
    expect(calls[0].url).toBe(URL_OK);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.cache).toBe('no-store');
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Customer: { Name: 'x' },
      Credentials: { CompanyID: 4242, APIKey: SECRET },
    });
  });

  it('keeps the headers the caller passed but forces the JSON content type', async () => {
    stubFetch(async () => json({ Status: 0 }));
    await sumitFetch(URL_OK, { body: body(), sumit, headers: { 'X-Trace': '1', 'Content-Type': 'text/plain' } });
    const headers = new Headers(calls[0].init.headers);
    expect([headers.get('x-trace'), headers.get('content-type')]).toEqual(['1', 'application/json']);
  });

  it('refuses a request without credentials, with bad credentials, or with a body that is not JSON text, without calling out', async () => {
    stubFetch(async () => json({ Status: 0 }));
    expect((await failure(sumitFetch(URL_OK, { body: body() }))).kind).toBe('invalid_request');
    expect((await failure(sumitFetch(URL_OK, { body: body(), sumit: { creds: { companyId: 0, apiKey: '' } } }))).kind).toBe('invalid_request');
    const notJson = await failure(sumitFetch(URL_OK, { body: '{bad', sumit }));
    expect([notJson.kind, notJson.outcomeUnknown]).toEqual(['invalid_request', false]);
    expect((await failure(sumitFetch(URL_OK, { body: new FormData(), sumit }))).kind).toBe('invalid_request');
    expect(calls).toHaveLength(0);
  });
});

describe('sumitFetch: the answer', () => {
  it('accepts Status as the number the live API sends and as the string the spec declares', async () => {
    stubFetch(async () => json({ Status: 0 }));
    await expect(sumitFetch(URL_OK, { body: body(), sumit })).resolves.toBeTruthy();
    stubFetch(async () => json({ Status: 'Success (0)' }));
    await expect(sumitFetch(URL_OK, { body: body(), sumit })).resolves.toBeTruthy();
  });

  it('reports a refusal by SUMIT as definitive, with the provider text cleaned, capped and kept out of the message', async () => {
    stubFetch(async () => json({ Status: 1, UserErrorMessage: `a\u0000b${'x'.repeat(500)}` }));
    const e = await failure(sumitFetch(URL_OK, { body: body(), sumit }));
    expect([e.kind, e.outcomeUnknown]).toEqual(['rejected', false]);
    expect(e.providerMessage).toHaveLength(300);
    expect(e.providerMessage).not.toMatch(/\p{Cc}/u);
    expect(e.message).not.toContain('xxx');
  });

  it('treats a technical error, an unknown status and a missing status as "money may have moved"', async () => {
    stubFetch(async () => json({ Status: 2 }));
    expect(await failure(sumitFetch(URL_OK, { body: body(), sumit }))).toMatchObject({ kind: 'provider_error', outcomeUnknown: true });
    stubFetch(async () => json({ Status: 'weird' }));
    expect(await failure(sumitFetch(URL_OK, { body: body(), sumit }))).toMatchObject({ kind: 'unknown_status', outcomeUnknown: true });
    stubFetch(async () => json({ Data: {} }));
    expect(await failure(sumitFetch(URL_OK, { body: body(), sumit }))).toMatchObject({ kind: 'unknown_status', outcomeUnknown: true });
  });

  it('reports a non-2xx answer with its HTTP status', async () => {
    stubFetch(async () => json({}, { status: 500 }));
    expect(await failure(sumitFetch(URL_OK, { body: body(), sumit }))).toMatchObject({ kind: 'http_error', httpStatus: 500, outcomeUnknown: true });
  });

  it('rejects a body that is null, an array, or a failing stream, without leaking the stream error', async () => {
    stubFetch(async () => json(null));
    expect((await failure(sumitFetch(URL_OK, { body: body(), sumit }))).kind).toBe('bad_body');
    stubFetch(async () => json([1]));
    expect((await failure(sumitFetch(URL_OK, { body: body(), sumit }))).kind).toBe('bad_body');
    stubFetch(async () => failingBody('application/json'));
    const e = await failure(sumitFetch(URL_OK, { body: body(), sumit }));
    expect(e.kind).toBe('bad_body');
    expect(leaks(e)).toBe(false);
  });

  it('rejects a JSON operation that is answered with a file', async () => {
    stubFetch(async () => bytes('%PDF-1.4 x'));
    expect((await failure(sumitFetch(URL_OK, { body: body(), sumit }))).kind).toBe('bad_body');
  });
});

describe('sumitFetch: the network', () => {
  it('never lets the original fetch error through, since it can echo the request and its key', async () => {
    stubFetch(async () => {
      throw new TypeError(`fetch failed ${SECRET}`);
    });
    const e = await failure(sumitFetch(URL_OK, { body: body(), sumit }));
    expect([e.kind, e.outcomeUnknown]).toEqual(['unreachable', true]);
    expect(leaks(e)).toBe(false);
  });

  it('gives up after timeoutMs', async () => {
    stubFetch(neverAnswers);
    const started = Date.now();
    const e = await failure(sumitFetch(URL_OK, { body: body(), sumit: { ...sumit, timeoutMs: 30 } }));
    expect(e.kind).toBe('unreachable');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('honours the abort signal the caller passed, long before the timeout', async () => {
    stubFetch(neverAnswers);
    const caller = new AbortController();
    const started = Date.now();
    const pending = failure(sumitFetch(URL_OK, { body: body(), sumit: { ...sumit, timeoutMs: 400 }, signal: caller.signal }));
    setTimeout(() => caller.abort(), 10);
    expect((await pending).kind).toBe('unreachable');
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('sumitFetchPdf', () => {
  const url = 'https://api.sumit.co.il/accounting/documents/getpdf/';

  it('returns the file as a Blob and sends the document request with the credentials', async () => {
    stubFetch(async () => bytes('%PDF-1.4 hello'));
    const pdf = await sumitFetchPdf(url, { body: body({ DocumentID: 9, Original: false }), sumit });
    expect(pdf).toBeInstanceOf(Blob);
    expect(await pdf.slice(0, 5).text()).toBe('%PDF-');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ DocumentID: 9, Original: false, Credentials: { CompanyID: 4242, APIKey: SECRET } });
  });

  it('refuses anything that is not a PDF, whatever its content type says', async () => {
    stubFetch(async () => bytes('not a pdf'));
    expect((await failure(sumitFetchPdf(url, { body: body(), sumit }))).kind).toBe('bad_body');
    stubFetch(async () => bytes('<html>', 'text/html'));
    expect((await failure(sumitFetchPdf(url, { body: body(), sumit }))).kind).toBe('bad_body');
  });

  it('turns SUMIT\'s JSON error (a missing document comes back as 200 + JSON) into a definitive refusal', async () => {
    stubFetch(async () => json({ Data: null, Status: 1, UserErrorMessage: 'Document not found: 1' }));
    expect(await failure(sumitFetchPdf(url, { body: body(), sumit }))).toMatchObject({ kind: 'rejected', outcomeUnknown: false });
  });

  it('never treats a JSON success as a file', async () => {
    stubFetch(async () => json({ Status: 0, Data: {} }));
    expect((await failure(sumitFetchPdf(url, { body: body(), sumit }))).kind).toBe('bad_body');
  });

  it('does not leak a failing stream', async () => {
    stubFetch(async () => failingBody('application/pdf'));
    const e = await failure(sumitFetchPdf(url, { body: body(), sumit }));
    expect(e.kind).toBe('bad_body');
    expect(leaks(e)).toBe(false);
  });
});
