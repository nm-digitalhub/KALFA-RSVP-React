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
const { consentEnabled, enqueueSync } = vi.hoisted(() => ({ consentEnabled: vi.fn(), enqueueSync: vi.fn() }));
vi.mock('@/lib/data/marketing-consent', () => ({ isMarketingConsentEnabled: consentEnabled }));
vi.mock('@/lib/data/marketing-contact-sync', () => ({ enqueueMarketingContactSync: enqueueSync }));

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
  // The shape GoTrue returns on success: data always present, user set.
  verifyOtp.mockResolvedValue({ data: { user: { id: 'u-1' }, session: null }, error: null });
  consentEnabled.mockResolvedValue(true);
  enqueueSync.mockResolvedValue(undefined);
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

  it('wrong / expired OTP → the expired page, carrying the type so it can offer the right recovery', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    await expect(
      confirmOtp(fd({ token_hash: 'bad', type: 'recovery', next: '/auth/reset-password' })),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('/auth/confirm/expired?type=recovery'),
    });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'bad', type: 'recovery' });
  });

  it('an expired SIGNUP link keeps its own type — the page must not offer a password reset', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    await expect(
      confirmOtp(fd({ token_hash: 'bad', type: 'signup', next: '/app' })),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('/auth/confirm/expired?type=signup'),
    });
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

describe('confirmOtp — marketing contact sync', () => {
  const confirm = (type: string) =>
    expect(confirmOtp(fd({ token_hash: 'good', type, next: '/app' }))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });

  it('a confirmed signup queues a resubscribe sync for that user', async () => {
    await confirm('signup');
    expect(enqueueSync).toHaveBeenCalledWith({ userId: 'u-1', resubscribe: true });
  });

  it('a confirmed email change queues a plain sync', async () => {
    await confirm('email_change');
    expect(enqueueSync).toHaveBeenCalledWith({ userId: 'u-1' });
  });

  it('recovery and magic links queue nothing', async () => {
    await confirm('recovery');
    await confirm('magiclink');
    expect(enqueueSync).not.toHaveBeenCalled();
  });

  it('nothing is queued while the feature is off, or when the code failed', async () => {
    consentEnabled.mockResolvedValue(false);
    await confirm('signup');
    consentEnabled.mockResolvedValue(true);
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'expired' } });
    await confirm('signup');
    expect(enqueueSync).not.toHaveBeenCalled();
  });

  it('a queue failure never changes the redirect', async () => {
    enqueueSync.mockRejectedValue(new Error('pgboss down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(confirmOtp(fd({ token_hash: 'good', type: 'signup', next: '/app' }))).rejects.toMatchObject({
      digest: expect.stringContaining('replace;/app;'),
    });
  });
});
