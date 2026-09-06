import { beforeEach, describe, expect, it, vi } from 'vitest';

// updatePassword is a Server Action guarding a security-sensitive mutation. Pin
// its contract: no updateUser without (a) valid input AND (b) a verified session;
// error passthrough; success → redirect(/app). Patterns mirror dal.test.ts /
// join actions.test.ts (stub server-only; model redirect()'s NEXT_REDIRECT).
vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  }),
}));

const { getUser, updateUser, signInWithPassword, resend } = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signInWithPassword: vi.fn(),
  resend: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser, updateUser, signInWithPassword, resend, resetPasswordForEmail: vi.fn() },
  })),
}));

import { login, resendConfirmationEmail, updatePassword } from './actions';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const VALID = { password: 'aVeryGoodPass1!', confirm: 'aVeryGoodPass1!' };

beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  updateUser.mockResolvedValue({ error: null });
  signInWithPassword.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ error: null });
});

const CREDS = { email: 'guest@example.com', password: 'aVeryGoodPass1!' };

// The generic 'wrong email or password' is anti-enumeration and must hold for
// every failure EXCEPT email_not_confirmed, which GoTrue only returns once the
// password already matched (an unconfirmed account probed with a wrong password
// answers invalid_credentials, same as an address that does not exist).
describe('login', () => {
  it('email_not_confirmed → the real reason plus the address, so the form can offer a resend', async () => {
    signInWithPassword.mockResolvedValue({
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });
    const res = await login(null, fd(CREDS));
    expect(res?.error).toContain('לא אומת');
    expect(res?.unconfirmedEmail).toBe(CREDS.email);
  });

  it('invalid_credentials → generic message; never reveals whether the account exists', async () => {
    signInWithPassword.mockResolvedValue({
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const res = await login(null, fd(CREDS));
    expect(res?.error).toBe('אימייל או סיסמה שגויים');
    expect(res?.unconfirmedEmail).toBeUndefined();
  });

  it('an error carrying no code → generic message (never leaks the provider text)', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'boom' } });
    const res = await login(null, fd(CREDS));
    expect(res?.error).toBe('אימייל או סיסמה שגויים');
  });

  it('success → redirect to /app', async () => {
    await expect(login(null, fd(CREDS))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/app;'),
    });
  });

  it('invalid input → fieldErrors; signInWithPassword NOT called', async () => {
    const res = await login(null, fd({ email: 'not-an-email', password: 'x' }));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(res?.fieldErrors).toBeTruthy();
  });
});

describe('resendConfirmationEmail', () => {
  it('sends with the /auth/confirm redirect so the email link keeps our host', async () => {
    const res = await resendConfirmationEmail(null, fd({ email: CREDS.email }));
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: CREDS.email,
      options: { emailRedirectTo: 'https://beta.kalfa.me/auth/confirm' },
    });
    expect(res?.notice).toBeTruthy();
    expect(res?.error).toBeUndefined();
  });

  it('a provider failure returns the SAME notice — resend is not enumeration-safe on its own', async () => {
    const ok = await resendConfirmationEmail(null, fd({ email: CREDS.email }));
    resend.mockResolvedValue({ error: { code: 'validation_failed', message: 'User already confirmed' } });
    const failed = await resendConfirmationEmail(null, fd({ email: CREDS.email }));
    expect(failed?.notice).toBe(ok?.notice);
    expect(failed?.error).toBeUndefined();
  });

  it('invalid email → fieldErrors; resend NOT called', async () => {
    const res = await resendConfirmationEmail(null, fd({ email: 'nope' }));
    expect(resend).not.toHaveBeenCalled();
    expect(res?.fieldErrors?.email?.length).toBeTruthy();
  });
});

describe('updatePassword', () => {
  it('validation fails (short password) → fieldErrors; getUser + updateUser NOT called', async () => {
    const res = await updatePassword(null, fd({ password: 'short', confirm: 'short' }));
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(res?.fieldErrors?.password?.length).toBeTruthy();
  });

  it('validation fails (confirm mismatch) → fieldErrors.confirm; updateUser NOT called', async () => {
    const res = await updatePassword(
      null,
      fd({ password: 'aVeryGoodPass1!', confirm: 'different12345' }),
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(res?.fieldErrors?.confirm?.[0]).toBe('הסיסמאות אינן תואמות');
  });

  it('no authenticated session → error; updateUser NOT called', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updatePassword(null, fd(VALID));
    expect(getUser).toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(res).toEqual({ error: 'קישור האיפוס אינו תקף או שפג תוקפו. בקשו קישור חדש.' });
  });

  it('updateUser returns error → error state (called with the new password only)', async () => {
    updateUser.mockResolvedValue({ error: { message: 'weak' } });
    const res = await updatePassword(null, fd(VALID));
    expect(updateUser).toHaveBeenCalledWith({ password: VALID.password });
    expect(res).toEqual({ error: 'עדכון הסיסמה נכשל. נסו שוב.' });
  });

  it('success → updateUser then redirect(/app)', async () => {
    await expect(updatePassword(null, fd(VALID))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/app;'),
    });
    expect(updateUser).toHaveBeenCalledWith({ password: VALID.password });
  });
});
