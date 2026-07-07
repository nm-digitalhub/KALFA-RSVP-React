import { beforeEach, describe, expect, it, vi } from 'vitest';

// confirmOtp is the POST-only verification for the interstitial. Pin its contract
// against the REAL redirect policy (@/lib/url is NOT mocked) — only stub
// server-only, model redirect()'s NEXT_REDIRECT, mock the supabase client, and
// pin APP_ORIGIN so resolveAppRedirectPath is deterministic.
vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  }),
}));

const { createClient, verifyOtp } = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient }));

import { confirmOtp } from './actions';

const ORIGIN = 'https://beta.kalfa.me';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  vi.clearAllMocks();
  createClient.mockResolvedValue({ auth: { verifyOtp } });
  verifyOtp.mockResolvedValue({ error: null });
});

describe('confirmOtp — POST verification', () => {
  it('valid → verifyOtp(token_hash/type) then redirect to the validated internal next', async () => {
    await expect(
      confirmOtp(fd({ token_hash: 'good', type: 'recovery', next: '/auth/reset-password' })),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/auth/reset-password;'),
    });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'good', type: 'recovery' });
  });

  it('hostile next → /app (verify still runs on the valid token)', async () => {
    await expect(
      confirmOtp(fd({ token_hash: 'good', type: 'recovery', next: '//evil.example' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('replace;/app;') });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'good', type: 'recovery' });
  });

  it('wrong / expired OTP → /auth/login', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    await expect(
      confirmOtp(fd({ token_hash: 'bad', type: 'recovery', next: '/auth/reset-password' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('/auth/login') });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'bad', type: 'recovery' });
  });

  it('invalid type → /auth/login; NO client created, NO verifyOtp', async () => {
    await expect(
      confirmOtp(fd({ token_hash: 'good', type: 'bogus', next: '/auth/reset-password' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('/auth/login') });
    expect(createClient).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('missing token_hash → /auth/login; NO client created, NO verifyOtp', async () => {
    await expect(confirmOtp(fd({ type: 'recovery' }))).rejects.toMatchObject({
      digest: expect.stringContaining('/auth/login'),
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('email_change (real settings email-change flow) → verifyOtp then redirect to next', async () => {
    await expect(
      confirmOtp(fd({ token_hash: 'good', type: 'email_change', next: '/app' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('replace;/app;') });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'good', type: 'email_change' });
  });
});
