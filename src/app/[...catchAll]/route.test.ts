import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { GET, HEAD, POST } = await import('./route');

function request(path: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(`https://beta.kalfa.me${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
  });
}

describe('catch-all 404 route', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
  });

  // Measured live 2026-08-24: calling next/navigation's notFound() from a
  // Route Handler serves a genuinely empty body (no rendered UI, no
  // Content-Type) — documented behavior ("serves a 404 to the caller"), but a
  // regression from the site's actual not-found.tsx page. This suite asserts
  // the hand-authored HTML fallback instead, so that regression can't recur
  // silently.
  it('serves the Hebrew not-found HTML page when no Accept header is sent', async () => {
    const res = GET(request('/does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('אופס, הדף הזה לא ברשימת המוזמנים');
    expect(body).toContain('<a href="/" class="btn">');
    expect(body).toContain('<a href="/" class="wordmark"><img src="/icons/icon.svg"');
    expect(body).toContain('onclick="history.back()"');
    expect(body).toContain('href="/faq"');
    expect(body).toContain('href="/privacy"');
    // No live network dependency for the font — see the function's header
    // comment (a prior version added a fonts.googleapis.com <link>, removed).
    expect(body).not.toContain('fonts.googleapis.com');
  });

  it('serves the Hebrew not-found HTML page for a plain browser Accept header', async () => {
    const req = request('/does-not-exist', {
      headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });
    const res = GET(req);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('serves the Hebrew not-found HTML page for a non-GET/HEAD method even with Accept: text/markdown', async () => {
    const req = request('/does-not-exist', { method: 'POST', headers: { accept: 'text/markdown' } });
    const res = POST(req);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('serves the Hebrew not-found HTML page for RSC/prefetch traffic even with Accept: text/markdown', async () => {
    const req = request('/does-not-exist', {
      headers: { accept: 'text/markdown', rsc: '1' },
    });
    const res = GET(req);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('serves the Hebrew not-found HTML page when Accept rejects both representations (406 is not introduced for a missing resource)', async () => {
    const req = request('/does-not-exist', {
      headers: { accept: 'text/markdown;q=0, text/html;q=0' },
    });
    const res = GET(req);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('serves a short Markdown 404 body with links to the real pages for Accept: text/markdown', () => {
    const res = GET(request('/does-not-exist', { headers: { accept: 'text/markdown' } }));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('vary')).toBe('Accept');
    return expect(res.text()).resolves.toContain('https://beta.kalfa.me/faq');
  });

  it('serves the Markdown 404 for HEAD too', () => {
    const res = HEAD(request('/does-not-exist', { method: 'HEAD', headers: { accept: 'text/markdown' } }));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });

  it('never reads the request Host for the Markdown links — only the trusted APP_ORIGIN', () => {
    const spoofed = new NextRequest('https://evil.example/does-not-exist', {
      method: 'GET',
      headers: { accept: 'text/markdown' },
    });
    return expect(GET(spoofed).text()).resolves.not.toContain('evil.example');
  });

  it('sets Vary: Accept on every response, Markdown or HTML', () => {
    expect(GET(request('/does-not-exist')).headers.get('vary')).toBe('Accept');
    expect(
      GET(request('/does-not-exist', { headers: { accept: 'text/markdown' } })).headers.get('vary'),
    ).toBe('Accept');
  });
});
