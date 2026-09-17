import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { GET } from './route';

// The browser half of the public webhook endpoint.
//
// ⚠️ THIS EXISTS BECAUSE OF AN OBSERVED FAILURE, not a hypothetical. Opening the
// address the editor hands an operator downloaded a FILE NAMED AFTER THE TOKEN
// on iOS Safari (reported 2026-09-17). Next answered 405 with no `Content-Type`,
// and `X-Content-Type-Options: nosniff` forbade the browser from guessing, so it
// had nothing to render and fell back to saving bytes.
//
// The `POST` half is covered by `webhook-trigger.test.ts`, which owns the
// question of which tokens open the endpoint. This file owns only the property
// that makes a GET safe: that it is CONSTANT.

describe('a browser opening the webhook address', () => {
  it('answers 405 and says which method the endpoint takes', async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'method_not_allowed',
    });
  });

  it('⚠️ renders as text rather than downloading — the first reported bug', () => {
    // A JSON content type is what lets the browser display the body instead of
    // treating the response as an opaque attachment. Without it, `nosniff` turns
    // any answer into a download named after the last path segment: the token.
    expect(response_contentType(GET())).toMatch(/application\/json/);
  });

  it('⚠️ declares utf-8, or the Hebrew hint is mojibake — the second one', () => {
    // `Response.json()` sets a bare `application/json` and never a charset.
    // Measured on iOS Safari 2026-09-17: the hint rendered as `×©×œ×—×•`, i.e.
    // these UTF-8 bytes read as Windows-1252. The bytes were always correct;
    // only the label was missing.
    expect(response_contentType(GET())).toMatch(/charset=utf-8/i);
  });

  it('⚠️ is IDENTICAL for a real token and a made-up one — no oracle', async () => {
    // The handler takes no parameters at all, which is the point: it cannot
    // branch on the token even by accident. A GET that distinguished a live
    // token from a wrong one would hand an attacker a free way to confirm
    // guesses — the very thing POST avoids by answering 404 to both a wrong
    // token and a disarmed workflow.
    const [a, b] = [GET(), GET()];

    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
    expect(GET.length).toBe(0);
  });

  it('⚠️ says a browser visit never starts a run', async () => {
    // The sentence an operator needs: the address is not broken, it is simply
    // not reachable from an address bar. Without it, "my webhook downloads a
    // file" reads as a broken integration.
    const { hint } = (await GET().json()) as { hint: string };

    expect(hint).toContain('POST');
    expect(hint).toContain('GET');
  });
});

function response_contentType(response: Response): string {
  return response.headers.get('content-type') ?? '';
}
