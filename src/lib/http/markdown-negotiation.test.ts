import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { addVary, isEligibleRequestMethod, isNegotiableRequest, negotiateMarkdown } from './markdown-negotiation';

function request(
  path: string,
  init?: { method?: string; headers?: Record<string, string> },
): NextRequest {
  return new NextRequest(`https://beta.kalfa.me${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
  });
}

describe('negotiateMarkdown', () => {
  it('returns html when Accept is absent (RFC 9110 §12.5.1: accepts anything, HTML is the default)', () => {
    expect(negotiateMarkdown(null)).toBe('html');
  });

  it('returns markdown for an exact, unqualified Accept: text/markdown', () => {
    expect(negotiateMarkdown('text/markdown')).toBe('markdown');
  });

  it('returns html for a plain browser Accept header', () => {
    expect(negotiateMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe('html');
  });

  it('picks the higher-quality representation when both are offered', () => {
    expect(negotiateMarkdown('text/markdown;q=0.9, text/html;q=0.5')).toBe('markdown');
    expect(negotiateMarkdown('text/markdown;q=0.3, text/html;q=0.8')).toBe('html');
  });

  it('defaults to html on a tie, including a bare */*', () => {
    expect(negotiateMarkdown('*/*')).toBe('html');
    expect(negotiateMarkdown('text/markdown;q=0.5, text/html;q=0.5')).toBe('html');
  });

  it('a more specific range wins over a wildcard at any q', () => {
    // text/* q=0.1 is still more specific than */* q=1 for text/html.
    expect(negotiateMarkdown('*/*;q=1, text/*;q=0.1')).toBe('html');
  });

  it('returns not-acceptable only when the client explicitly rejects both', () => {
    expect(negotiateMarkdown('text/markdown;q=0, text/html;q=0')).toBe('not-acceptable');
    expect(negotiateMarkdown('application/json')).toBe('not-acceptable');
  });

  it('q=0 on markdown with html explicitly listed falls through to html, not 406', () => {
    expect(negotiateMarkdown('text/markdown;q=0, text/html')).toBe('html');
  });

  it('q=0 on markdown alone is 406, not a silent html fallback — the header names one representation and rejects it, so nothing else was offered', () => {
    expect(negotiateMarkdown('text/markdown;q=0')).toBe('not-acceptable');
  });

  it('a trailing wildcard still rescues html even when markdown is explicitly rejected', () => {
    expect(negotiateMarkdown('text/markdown;q=0, */*')).toBe('html');
  });

  it('ignores malformed entries instead of throwing', () => {
    expect(negotiateMarkdown('garbage, , text/markdown')).toBe('markdown');
  });

  it('clamps an out-of-range q to the RFC 9110 bound instead of letting it out-rank a valid q=1 (regression: q=2 must not beat html)', () => {
    expect(negotiateMarkdown('text/markdown;q=2, text/html;q=1')).toBe('html');
    expect(negotiateMarkdown('text/markdown;q=2, text/html')).toBe('html');
  });

  it('clamps a negative q to 0', () => {
    expect(negotiateMarkdown('text/markdown;q=-1')).toBe('not-acceptable');
    expect(negotiateMarkdown('text/markdown;q=-1, text/html')).toBe('html');
  });
});

describe('isNegotiableRequest', () => {
  it('accepts a plain GET to an allowlisted page', () => {
    expect(isNegotiableRequest(request('/'))).toBe(true);
    expect(isNegotiableRequest(request('/faq'))).toBe(true);
    expect(isNegotiableRequest(request('/contact'))).toBe(true);
    expect(isNegotiableRequest(request('/terms'))).toBe(true);
    expect(isNegotiableRequest(request('/privacy'))).toBe(true);
    expect(isNegotiableRequest(request('/cookies'))).toBe(true);
  });

  it('accepts HEAD too', () => {
    expect(isNegotiableRequest(request('/faq', { method: 'HEAD' }))).toBe(true);
  });

  it('rejects a path that is not on the allowlist, including the not-yet-built /about', () => {
    expect(isNegotiableRequest(request('/about'))).toBe(false);
    expect(isNegotiableRequest(request('/app'))).toBe(false);
    expect(isNegotiableRequest(request('/admin'))).toBe(false);
    expect(isNegotiableRequest(request('/api/whatever'))).toBe(false);
    expect(isNegotiableRequest(request('/auth/login'))).toBe(false);
    expect(isNegotiableRequest(request('/r/some-token'))).toBe(false);
    expect(isNegotiableRequest(request('/g/some-token'))).toBe(false);
    expect(isNegotiableRequest(request('/ty/some-token'))).toBe(false);
    expect(isNegotiableRequest(request('/join/some-token'))).toBe(false);
    expect(isNegotiableRequest(request('/llms.txt'))).toBe(false);
    expect(isNegotiableRequest(request('/robots.txt'))).toBe(false);
    expect(isNegotiableRequest(request('/sitemap.xml'))).toBe(false);
  });

  it('rejects non-GET/HEAD methods on an allowlisted path', () => {
    expect(isNegotiableRequest(request('/faq', { method: 'POST' }))).toBe(false);
  });

  it('rejects a Next.js client-router RSC/prefetch fetch even on an allowlisted path', () => {
    expect(isNegotiableRequest(request('/', { headers: { rsc: '1' } }))).toBe(false);
    expect(isNegotiableRequest(request('/faq', { headers: { 'next-router-state-tree': 'x' } }))).toBe(false);
    expect(isNegotiableRequest(request('/faq', { headers: { 'next-router-prefetch': '1' } }))).toBe(false);
    expect(
      isNegotiableRequest(request('/faq', { headers: { 'next-router-segment-prefetch': '/faq' } })),
    ).toBe(false);
    expect(isNegotiableRequest(request('/faq', { headers: { 'next-action': 'x' } }))).toBe(false);
  });

  it('rejects a browser speculative prefetch', () => {
    expect(isNegotiableRequest(request('/faq', { headers: { purpose: 'prefetch' } }))).toBe(false);
    expect(isNegotiableRequest(request('/faq', { headers: { 'sec-purpose': 'prefetch;prerender' } }))).toBe(false);
  });
});

describe('isEligibleRequestMethod', () => {
  it('accepts GET/HEAD on any path — it has no path check of its own', () => {
    expect(isEligibleRequestMethod(request('/nothing-here-at-all'))).toBe(true);
    expect(isEligibleRequestMethod(request('/nothing-here-at-all', { method: 'HEAD' }))).toBe(true);
  });

  it('rejects non-GET/HEAD methods', () => {
    expect(isEligibleRequestMethod(request('/x', { method: 'POST' }))).toBe(false);
  });

  it('rejects Next.js router-internal and prefetch traffic, same as isNegotiableRequest', () => {
    expect(isEligibleRequestMethod(request('/x', { headers: { rsc: '1' } }))).toBe(false);
    expect(isEligibleRequestMethod(request('/x', { headers: { purpose: 'prefetch' } }))).toBe(false);
  });
});

describe('addVary', () => {
  it('sets Vary when none is present', () => {
    const headers = new Headers();
    addVary(headers, 'Accept');
    expect(headers.get('vary')).toBe('Accept');
  });

  it('appends to an existing Vary without dropping prior tokens', () => {
    const headers = new Headers({ vary: 'Accept-Encoding' });
    addVary(headers, 'Accept');
    expect(headers.get('vary')).toBe('Accept-Encoding, Accept');
  });

  it('is a no-op, case-insensitively, when the token is already present', () => {
    const headers = new Headers({ vary: 'accept, Accept-Encoding' });
    addVary(headers, 'Accept');
    expect(headers.get('vary')).toBe('accept, Accept-Encoding');
  });
});
