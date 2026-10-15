import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mightBeServerReferenceId } from 'next/dist/shared/lib/server-reference-info';
import { NEXT_ACTION_NOT_FOUND_HEADER } from 'next/dist/client/components/app-router-headers';

import { isPlausibleServerActionId } from '@/lib/security/server-action-id';

const updateSession = vi.fn(async () => new Response('session', { status: 200 }));
vi.mock('@/lib/supabase/proxy', () => ({ updateSession }));

const { proxy } = await import('@/proxy');

// A real Next 16 action id: two-hex info byte + 40-char hash = 42 characters.
const VALID_ACTION_ID = '00' + 'a'.repeat(40);

// What the INSTALLED Next answers for an action id that cannot be a Server
// Action (not 42 characters). Read from its own source rather than copied into
// this test, so the proxy cannot drift from Next unnoticed: it had — this file
// used to assert 404 / "Server action not found.", an older Next's answer, while
// the installed 16.4.1 answers 400 / "Invalid Server Action request.".
// If Next rewrites action-handler.js so these patterns stop matching, this
// fails on the upgrade — that is the cue to re-read the handler and src/proxy.ts.
function nextUnrecognizedActionAnswer(): { status: number; body: string } {
  const nextRoot = dirname(createRequire(import.meta.url).resolve('next/package.json'));
  const source = readFileSync(join(nextRoot, 'dist/server/app-render/action-handler.js'), 'utf8');
  const status = /function getUnrecognizedActionStatusCode\(actionId\)\s*\{\s*return actionId !== null && !\(0, _serverreferenceinfo\.mightBeServerReferenceId\)\(actionId\) \? (\d{3}) : (\d{3});/.exec(
    source,
  );
  const body = /function getUnrecognizedActionResponseBody\(statusCode\)\s*\{\s*return statusCode === (\d{3}) \? '([^']+)' : '([^']+)';/.exec(
    source,
  );
  if (!status || !body) {
    throw new Error(
      "Next's unrecognized-action handler no longer matches the shape src/proxy.ts mirrors — re-read node_modules/next/dist/server/app-render/action-handler.js and update src/proxy.ts.",
    );
  }
  const malformedStatus = Number(status[1]);
  // The body function names the status whose text is its first string.
  const body400 = Number(body[1]) === malformedStatus ? body[2] : body[3];
  return { status: malformedStatus, body: body400 };
}

function post(actionId?: string): NextRequest {
  const headers = new Headers();
  if (actionId !== undefined) headers.set('next-action', actionId);
  return new NextRequest('https://beta.kalfa.me/app', { method: 'POST', headers });
}

describe('proxy — malformed Server Action ids', () => {
  beforeEach(() => updateSession.mockClear());

  // Every value below was observed in the live error log between 31.07 and
  // 16.08. The 40-hex one is the interesting case: it LOOKS like a real id
  // (it is the pre-Next-16 format) but cannot name an action in this build.
  it.each([
    ['the literal "x" (427 occurrences live)', 'x'],
    ['the literal "action"', 'action'],
    ['a single digit', '0'],
    ['a two-character token', 'qz'],
    ['a pre-Next-16 40-hex id', 'f'.repeat(40)],
    ['an over-long id', 'a'.repeat(64)],
    ['an empty header', ''],
  ])('answers %s without invoking the session refresh', async (_label, id) => {
    const res = await proxy(post(id));
    expect(res.status).toBe(nextUnrecognizedActionAnswer().status);
    expect(updateSession).not.toHaveBeenCalled();
  });

  // The client router keys its recovery off the header; status, body and
  // content-type are kept identical to Next's so the answer is the same whether
  // the proxy or Next's action pipeline gave it. The expected values come from
  // the installed Next (above); the literals pin what that derivation found at
  // the time of writing, so a failure shows which side moved.
  it('reproduces the installed Next\'s unrecognized-action response exactly', async () => {
    const expected = nextUnrecognizedActionAnswer();
    expect(expected).toEqual({ status: 400, body: 'Invalid Server Action request.' });

    const res = await proxy(post('x'));
    expect(res.status).toBe(expected.status);
    expect(res.headers.get('x-nextjs-action-not-found')).toBe('1');
    expect(res.headers.get('content-type')).toBe('text/plain');
    await expect(res.text()).resolves.toBe(expected.body);
  });

  it('uses the header name and the id-length rule of the installed Next', () => {
    expect(NEXT_ACTION_NOT_FOUND_HEADER).toBe('x-nextjs-action-not-found');
    for (const id of ['', 'x', 'f'.repeat(40), VALID_ACTION_ID, 'a'.repeat(64)]) {
      expect(isPlausibleServerActionId(id)).toBe(mightBeServerReferenceId(id));
    }
  });

  it('passes a well-formed 42-character id straight through', async () => {
    await proxy(post(VALID_ACTION_ID));
    expect(updateSession).toHaveBeenCalledOnce();
  });

  // The overwhelming majority of traffic carries no action header at all;
  // it must never touch this branch.
  it('passes a request with no action header straight through', async () => {
    await proxy(post());
    expect(updateSession).toHaveBeenCalledOnce();
  });
});

function get(path: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`https://beta.kalfa.me${path}`, { method: 'GET', headers });
}

describe('proxy — markdown content negotiation (public allowlisted pages only)', () => {
  beforeEach(() => updateSession.mockClear());

  it('adds Vary: Accept to the ordinary HTML response on an allowlisted page, without changing anything else', async () => {
    const res = await proxy(get('/faq'));
    expect(updateSession).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('session');
    expect(res.headers.get('vary')).toBe('Accept');
  });

  it('never touches negotiation for a path outside the allowlist, even with Accept: text/markdown', async () => {
    const res = await proxy(get('/app', { accept: 'text/markdown' }));
    expect(updateSession).toHaveBeenCalledOnce();
    expect(res.headers.get('vary')).toBeNull();
  });

  it('never touches negotiation for a non-GET/HEAD request to an allowlisted page', async () => {
    const req = new NextRequest('https://beta.kalfa.me/faq', {
      method: 'POST',
      headers: { accept: 'text/markdown' },
    });
    const res = await proxy(req);
    expect(updateSession).toHaveBeenCalledOnce();
    expect(res.headers.get('vary')).toBeNull();
  });

  it('returns 406 when the client rejects both representations, without invoking the session refresh', async () => {
    const res = await proxy(get('/', { accept: 'text/markdown;q=0, text/html;q=0' }));
    expect(updateSession).not.toHaveBeenCalled();
    expect(res.status).toBe(406);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('vary')).toBe('Accept');
  });

  it('serves Markdown for Accept: text/markdown via the documented self-fetch pattern, bypassing updateSession on this leg', async () => {
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // The trusted origin (APP_ORIGIN), never the incoming request's Host —
      // proven by requesting a DIFFERENT host below and still landing here.
      expect(url).toBe('https://beta.kalfa.me/faq');
      void init;
      return new Response('<html><body><h1>שאלות נפוצות</h1><p>תוכן.</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      // The incoming request carries a HOST/origin an attacker fully
      // controls on a self-hosted server — the internal fetch must ignore
      // it entirely and use APP_ORIGIN, which is exactly what the mock above
      // asserts (`https://beta.kalfa.me/faq`, not `https://evil.example/faq`).
      const spoofed = new NextRequest('https://evil.example/faq', {
        method: 'GET',
        headers: { accept: 'text/markdown' },
      });
      const res = await proxy(spoofed);
      expect(updateSession).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      // The inner fetch carries nothing from the original request but a
      // synthetic Accept: text/html — no Cookie/Authorization/etc.
      const [, init] = fetchMock.mock.calls[0];
      expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({ accept: 'text/html' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(res.headers.get('vary')).toContain('Accept');
      await expect(res.text()).resolves.toContain('שאלות נפוצות');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
