import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// /auth/confirm is the AUTHORITY for the recovery/magic-link flow: it verifies
// the OTP (verifyOtp) and validates `next` against an open redirect. These tests
// exercise the REAL redirect policy — @/lib/url is NOT mocked, so the route runs
// the same resolveAppRedirectPath used by getAppUrl. url.ts imports 'server-only'
// (throws outside Next's server runtime) so we stub only that + createClient, and
// pin APP_ORIGIN so getAppOrigin resolves deterministically.
vi.mock('server-only', () => ({}));

const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp } })),
}));

import { GET } from './route';

const ORIGIN = 'https://beta.kalfa.me';

function call(qs: string): Promise<Response> {
  return GET(new Request(`${ORIGIN}/auth/confirm?${qs}`));
}
function location(res: Response): string {
  return res.headers.get('location') ?? '';
}

beforeAll(() => {
  vi.stubEnv('APP_ORIGIN', ORIGIN);
});
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ error: null });
});

describe('/auth/confirm — valid recovery token (positive)', () => {
  it('verifyOtp(type=recovery) → /auth/reset-password?x=1 (query kept)', async () => {
    const res = await call(
      `token_hash=good&type=recovery&next=${encodeURIComponent('/auth/reset-password?x=1')}`,
    );
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'good', type: 'recovery' });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/auth/reset-password?x=1`);
  });

  it('accepts a same-origin ABSOLUTE next, reduced to its path', async () => {
    const res = await call(
      `token_hash=good&type=recovery&next=${encodeURIComponent(`${ORIGIN}/auth/reset-password?x=1`)}`,
    );
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/auth/reset-password?x=1`);
  });
});

describe('/auth/confirm — hostile next is rejected → /app (with a VALID token)', () => {
  const TAB = String.fromCharCode(9);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const hostile = [
    'https:evil',
    'http:evil',
    'https:/evil',
    'javascript:alert(1)',
    'mailto:test@example.com',
    '//evil.example',
    '//beta.kalfa.me/auth/reset-password',
    '///beta.kalfa.me/auth/reset-password',
    'https://user:pass@beta.kalfa.me/auth/reset-password',
    '/\\evil.example',
    '\\\\evil.example',
    TAB + '//evil.example',
    LF + '//evil.example',
    CR + '//evil.example',
    '/' + TAB + '//evil.example',
    '/' + LF + '//evil.example',
    '/' + CR + '//evil.example',
    'https://evil.example',
  ];

  for (const next of hostile) {
    it(`rejects next=${JSON.stringify(next)} → /app`, async () => {
      const res = await call(
        `token_hash=good&type=recovery&next=${encodeURIComponent(next)}`,
      );
      expect(res.status).toBe(303);
      expect(location(res)).toBe(`${ORIGIN}/app`);
    });
  }
});

describe('/auth/confirm — missing / invalid token → /auth/login', () => {
  it('missing token_hash → /auth/login, verifyOtp never called', async () => {
    const res = await call('type=recovery&next=/auth/reset-password');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/auth/login`);
  });

  it('invalid/expired token → /auth/login', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    const res = await call('token_hash=bad&type=recovery&next=/auth/reset-password');
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'bad', type: 'recovery' });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/auth/login`);
  });

  it('unknown type → /auth/login, verifyOtp never called', async () => {
    const res = await call('token_hash=good&type=bogus&next=/auth/reset-password');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toBe(`${ORIGIN}/auth/login`);
  });
});
