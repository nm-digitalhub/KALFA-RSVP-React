import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { GET } from './route';

// The browser half of the public webhook endpoint.
//
// ⚠️ THIS EXISTS BECAUSE OF AN OBSERVED FAILURE, not a hypothetical — TWICE, and
// the first fix was wrong.
//
// 2026-09-17, iOS Safari: opening the address downloaded a FILE NAMED AFTER THE
// TOKEN. Next answered 405 with no `Content-Type`, and
// `X-Content-Type-Options: nosniff` forbade the browser from guessing, so it had
// nothing to render and saved bytes. The fix then was `application/json;
// charset=utf-8`, and THIS FILE ASSERTED that a JSON type "is what lets the
// browser display the body".
//
// 2026-09-22, Chrome: the owner opened it and it downloaded AGAIN. Checked live
// — the response carries only content-type, the four security headers and
// `allow`; there is no `Content-Disposition` anywhere. So the earlier claim was
// simply false: with `nosniff`, a top-level navigation to `application/json` is
// saved, not rendered. The media type is now `text/plain; charset=utf-8`, which
// renders in every browser, and the assertion below says so instead.
//
// THE LESSON, recorded because the test itself carried the wrong reason for five
// days: "the browser displays it" is a claim about a BROWSER, and the only
// evidence for it is a browser. A unit test can pin the header; it cannot pin
// what Chrome does with it.
//
// The `POST` half is covered by `webhook-trigger.test.ts`, which owns the
// question of which tokens open the endpoint. This file owns only the property
// that makes a GET safe: that it is CONSTANT.

// A browser sends no `x-kalfa-webhook-secret`, so `GET` answers with the hint.
// Driven through the REAL export rather than an internal helper — Next forbids a
// route file from exporting anything but its handlers, and a test that reached
// past that would be testing a shape the framework rejects.
const browserVisit = () =>
  GET(
    { headers: new Headers(), url: 'https://x.test/api/workflows/hook/anything' } as never,
    { params: Promise.resolve({ endpoint: 'anything' }) },
  ) as Response;

describe('a browser opening the webhook address', () => {
  it('answers 405 and says which method the endpoint takes', async () => {
    const response = browserVisit();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    await expect(response.text()).resolves.toContain('POST');
  });

  it('⚠️ is text/plain — JSON was tried and DOWNLOADED, twice', () => {
    // Not a style preference and not interchangeable with JSON. `nosniff` is set
    // on every route on purpose, and under it a top-level navigation to
    // `application/json` is saved to disk rather than shown — observed on iOS
    // Safari and then on Chrome. `text/plain` is the one type that renders under
    // `nosniff` for a body no machine parses.
    expect(response_contentType(browserVisit())).toMatch(/text\/plain/);
    expect(response_contentType(browserVisit())).not.toMatch(/application\/json/);
  });

  it('⚠️ declares utf-8, or the Hebrew hint is mojibake — the second one', () => {
    // `Response.json()` sets a bare `application/json` and never a charset.
    // Measured on iOS Safari 2026-09-17: the hint rendered as `×©×œ×—×•`, i.e.
    // these UTF-8 bytes read as Windows-1252. The bytes were always correct;
    // only the label was missing.
    expect(response_contentType(browserVisit())).toMatch(/charset=utf-8/i);
  });

  it('⚠️ is IDENTICAL for a real endpoint and a made-up one — no oracle', async () => {
    // A GET that distinguished a live address from a wrong one would hand an
    // attacker a free way to confirm guesses from an address bar — the very
    // thing POST avoids by answering the same 404 to a wrong secret and a
    // disarmed workflow.
    //
    // The old form of this test asserted `GET.length === 0`: the handler took no
    // arguments, so it could not branch. It takes them now, because a GET may be
    // a real webhook verb — so the property is asserted DIRECTLY instead, across
    // two different paths.
    const visit = (endpoint: string) =>
      GET(
        { headers: new Headers(), url: `https://x.test/api/workflows/hook/${endpoint}` } as never,
        { params: Promise.resolve({ endpoint }) },
      ) as Response;

    const [a, b] = [visit('an-address-that-exists'), visit('one-that-does-not')];

    expect(a.status).toBe(b.status);
    expect(a.headers.get('content-type')).toBe(b.headers.get('content-type'));
    expect(await a.text()).toBe(await b.text());
  });

  it('⚠️ says a browser visit never starts a run', async () => {
    // The sentence an operator needs: the address is not broken, it is simply
    // not reachable from an address bar. Without it, "my webhook downloads a
    // file" reads as a broken integration.
    const hint = await browserVisit().text();

    expect(hint).toContain('POST');
    expect(hint).toContain('GET');
    // The secret's home, since an operator reading this is mid-setup.
    expect(hint).toContain('x-kalfa-webhook-secret');
  });
});

function response_contentType(response: Response): string {
  return response.headers.get('content-type') ?? '';
}

// ---------------------------------------------------------------------------

describe('⚠️ GET is two things, split on the secret header', () => {
  // A browser visit and a legitimate GET webhook arrive at the same export. The
  // split has to keep the browser case CONSTANT — otherwise the address bar
  // becomes a way to ask "does this endpoint exist", which is exactly what POST
  // refuses to answer.
  const ctx = { params: Promise.resolve({ endpoint: 'anything' }) };
  const req = (headers: Record<string, string>) =>
    ({ headers: new Headers(headers), url: 'https://x.test/api/workflows/hook/anything' }) as never;

  it('a request with NO secret header gets the constant browser hint', async () => {
    const response = await GET(req({}), ctx);
    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).toMatch(/text\/plain/);
  });

  it('⚠️ and it is identical for every path — no existence oracle from a browser', async () => {
    const a = await GET(req({}), { params: Promise.resolve({ endpoint: 'real-looking' }) });
    const b = await GET(req({}), { params: Promise.resolve({ endpoint: 'made-up' }) });
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it('a request WITH a secret header is resolved instead of hinted', async () => {
    // It will not find anything here — no armed workflow is mocked — but it must
    // take the resolution path, whose answer is a JSON 404 rather than the
    // 405 text. The distinction IS the feature.
    const response = await GET(req({ 'x-kalfa-webhook-secret': 'whatever' }), ctx);
    expect(response.status).not.toBe(405);
  });
});
