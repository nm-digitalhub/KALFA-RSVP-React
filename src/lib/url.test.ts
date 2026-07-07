import { describe, expect, it, vi } from 'vitest';

// Exercise the REAL url.ts policy (only stub `server-only`, which throws outside
// Next's server runtime). APP_ORIGIN is unset here, so getAppOrigin falls back to
// the dev origin; assertions derive it from getAppUrl('/') and compare real
// origins / exact strings — never startsWith.
vi.mock('server-only', () => ({}));

import { getAppUrl, resolveAppRedirectPath } from './url';

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

// One shared policy → one hostile list for both entry points.
const HOSTILE = [
  '//evil.example',
  '//beta.kalfa.me/auth/reset-password', // protocol-relative, SAME origin — still rejected
  '///beta.kalfa.me/auth/reset-password', // triple-slash, same origin
  '/\\evil.example',
  '\\\\evil.example',
  TAB + '//evil.example',
  '/' + TAB + '//evil.example',
  '/' + LF + '//evil.example',
  '/' + CR + '//evil.example',
  LF + '//evil.example',
  'https://evil.example',
  'https://user:pass@beta.kalfa.me/auth/reset-password', // credentials, same host
  'https:evil',
  'http:evil',
  'https:/evil',
  'javascript:alert(1)',
  'mailto:test@example.com',
];

describe('getAppUrl — hostile / ambiguous targets are REJECTED (not coerced)', () => {
  for (const p of HOSTILE) {
    it(`rejects ${JSON.stringify(p)}`, async () => {
      await expect(getAppUrl(p)).rejects.toThrow();
    });
  }
});

describe('getAppUrl — legit targets preserved on APP_ORIGIN (incl. hash)', () => {
  it('keeps path, query AND hash', async () => {
    const origin = new URL(await getAppUrl('/')).origin;

    expect(await getAppUrl('/auth/confirm')).toBe(`${origin}/auth/confirm`);
    expect(await getAppUrl('auth/reset-password')).toBe(`${origin}/auth/reset-password`);
    expect(await getAppUrl('/app?x=1#h')).toBe(`${origin}/app?x=1#h`); // hash preserved
    expect(await getAppUrl('/a/b/../c')).toBe(`${origin}/a/c`);
    expect(new URL(await getAppUrl('/auth/confirm')).origin).toBe(origin);
  });
});

describe('resolveAppRedirectPath — SAME policy, reduced to pathname+search', () => {
  for (const p of HOSTILE) {
    it(`rejects ${JSON.stringify(p)}`, async () => {
      await expect(resolveAppRedirectPath(p)).rejects.toThrow();
    });
  }

  it('reduces legit targets to pathname+search (hash dropped)', async () => {
    const origin = new URL(await getAppUrl('/')).origin;

    expect(await resolveAppRedirectPath('/auth/reset-password?x=1')).toBe(
      '/auth/reset-password?x=1',
    );
    expect(await resolveAppRedirectPath('auth/reset-password')).toBe('/auth/reset-password');
    expect(await resolveAppRedirectPath('/app?x=1#h')).toBe('/app?x=1'); // hash dropped
    // A same-origin ABSOLUTE URL is accepted and reduced to its path:
    expect(await resolveAppRedirectPath(`${origin}/auth/reset-password?x=1`)).toBe(
      '/auth/reset-password?x=1',
    );
  });
});
