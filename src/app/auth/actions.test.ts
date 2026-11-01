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

const { getUser, updateUser, signInWithPassword, resend, signUp, requestHeaders, recordConsent, consentEnabled } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signInWithPassword: vi.fn(),
    resend: vi.fn(),
    signUp: vi.fn(),
    requestHeaders: { current: new Headers() },
    recordConsent: vi.fn(),
    consentEnabled: vi.fn(),
  }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser, updateUser, signInWithPassword, resend, signUp, resetPasswordForEmail: vi.fn() },
  })),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: vi.fn() })),
  headers: vi.fn(async () => requestHeaders.current),
}));
vi.mock('@/lib/data/marketing-consent', () => ({
  recordConsent,
  isMarketingConsentEnabled: consentEnabled,
}));

import { login, resendConfirmationEmail, signup, updatePassword } from './actions';

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
    const res = await login({}, fd(CREDS));
    expect(res?.data?.error).toContain('לא אומת');
    expect(res?.data?.unconfirmedEmail).toBe(CREDS.email);
  });

  it('invalid_credentials → generic message; never reveals whether the account exists', async () => {
    signInWithPassword.mockResolvedValue({
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const res = await login({}, fd(CREDS));
    expect(res?.serverError).toBe('אימייל או סיסמה שגויים');
    expect(res?.data?.unconfirmedEmail).toBeUndefined();
  });

  it('an error carrying no code → generic message (never leaks the provider text)', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'boom' } });
    const res = await login({}, fd(CREDS));
    expect(res?.serverError).toBe('אימייל או סיסמה שגויים');
  });

  it('success → redirect to /app', async () => {
    await expect(login({}, fd(CREDS))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/app;'),
    });
  });

  it('success with `next` → resumes that same-origin path, query intact (OAuth consent)', async () => {
    const next = '/oauth/consent?authorization_id=abc-123';
    await expect(login({}, fd({ ...CREDS, next }))).rejects.toMatchObject({
      digest: expect.stringContaining(`NEXT_REDIRECT;replace;${next};`),
    });
  });

  it('success with the proxy’s `redirectTo` → resumes the protected page', async () => {
    await expect(login({}, fd({ ...CREDS, redirectTo: '/app/events' }))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/app/events;'),
    });
  });

  it.each([
    ['an absolute off-origin URL', 'https://evil.example/steal'],
    ['a protocol-relative URL', '//evil.example/steal'],
    ['a backslash authority trick', '/\\evil.example'],
    ['a same-origin absolute URL (not a path)', 'https://beta.kalfa.me/app'],
  ])('success with %s as `next` → /app, never an open redirect', async (_label, next) => {
    await expect(login({}, fd({ ...CREDS, next }))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/app;'),
    });
  });

  it('invalid input → fieldErrors; signInWithPassword NOT called', async () => {
    const res = await login({}, fd({ email: 'not-an-email', password: 'x' }));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(res?.validationErrors?.fieldErrors).toBeTruthy();
  });

  it('empty fields → the schema’s own Hebrew messages, not Zod’s English one for a missing value', async () => {
    const res = await login({}, fd({ email: '', password: '' }));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(res).toEqual({
      validationErrors: {
        formErrors: [],
        fieldErrors: { email: ['כתובת אימייל לא תקינה'], password: ['נא להזין סיסמה'] },
      },
    });
  });
});

describe('resendConfirmationEmail', () => {
  it('sends with the /auth/confirm redirect so the email link keeps our host', async () => {
    const res = await resendConfirmationEmail({}, fd({ email: CREDS.email }));
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: CREDS.email,
      options: { emailRedirectTo: 'https://beta.kalfa.me/auth/confirm' },
    });
    expect(res?.data?.notice).toBeTruthy();
    expect(res?.serverError).toBeUndefined();
  });

  it('a provider failure returns the SAME notice — resend is not enumeration-safe on its own', async () => {
    const ok = await resendConfirmationEmail({}, fd({ email: CREDS.email }));
    resend.mockResolvedValue({ error: { code: 'validation_failed', message: 'User already confirmed' } });
    const failed = await resendConfirmationEmail({}, fd({ email: CREDS.email }));
    expect(failed?.data?.notice).toBe(ok?.data?.notice);
    expect(failed?.serverError).toBeUndefined();
  });

  it('invalid email → fieldErrors; resend NOT called', async () => {
    const res = await resendConfirmationEmail({}, fd({ email: 'nope' }));
    expect(resend).not.toHaveBeenCalled();
    expect(res?.validationErrors?.fieldErrors?.email?.length).toBeTruthy();
  });
});

describe('updatePassword', () => {
  it('validation fails (short password) → fieldErrors; getUser + updateUser NOT called', async () => {
    const res = await updatePassword({}, fd({ password: 'short', confirm: 'short' }));
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(res?.validationErrors?.fieldErrors?.password?.length).toBeTruthy();
  });

  it('validation fails (confirm mismatch) → fieldErrors.confirm; updateUser NOT called', async () => {
    const res = await updatePassword(
      {},
      fd({ password: 'aVeryGoodPass1!', confirm: 'different12345' }),
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(res?.validationErrors?.fieldErrors?.confirm?.[0]).toBe('הסיסמאות אינן תואמות');
  });

  it('no authenticated session → error; updateUser NOT called', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updatePassword({}, fd(VALID));
    expect(getUser).toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(res).toEqual({ serverError: 'קישור האיפוס אינו תקף או שפג תוקפו. בקשו קישור חדש.' });
  });

  it('updateUser returns error → error state (called with the new password only)', async () => {
    updateUser.mockResolvedValue({ error: { message: 'weak' } });
    const res = await updatePassword({}, fd(VALID));
    expect(updateUser).toHaveBeenCalledWith({ password: VALID.password });
    expect(res).toEqual({ serverError: 'עדכון הסיסמה נכשל. נסו שוב.' });
  });

  it('success → updateUser then redirect(/app)', async () => {
    await expect(updatePassword({}, fd(VALID))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/app;'),
    });
    expect(updateUser).toHaveBeenCalledWith({ password: VALID.password });
  });
});

// signup() records marketing-email consent only for a genuine new account whose owner ticked the box, after the
// duplicate check, with the server's wording (recordConsent) and the socket IP — never a client-supplied value.
describe('signup — marketing consent', () => {
  const FORM = {
    email: 'dana@example.com',
    password: 'aVeryGoodPass1!',
    full_name: 'דנה כהן',
    phone: '',
    terms_accepted: 'on',
  };
  const NEW_USER = { id: 'new-user', email: 'dana@example.com', identities: [{ id: 'i1' }] };

  beforeEach(() => {
    consentEnabled.mockResolvedValue(true);
    recordConsent.mockResolvedValue('recorded');
    signUp.mockResolvedValue({ data: { user: NEW_USER, session: null }, error: null });
    requestHeaders.current = new Headers({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.9',
      'user-agent': 'UA/1',
    });
  });

  const run = (fields: Record<string, string>) => expect(signup(undefined, {}, fd(fields))).rejects.toThrow('NEXT_REDIRECT');

  it('ticked → one grant for the new user, socket IP, user agent', async () => {
    await run({ ...FORM, marketing_opt_in: 'on' });
    expect(recordConsent).toHaveBeenCalledTimes(1);
    expect(recordConsent).toHaveBeenCalledWith({
      userId: 'new-user',
      email: 'dana@example.com',
      action: 'grant',
      source: 'signup',
      ip: '203.0.113.7',
      userAgent: 'UA/1',
    });
  });

  it('unticked → nothing recorded', async () => {
    await run(FORM);
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('switched off → nothing recorded even when ticked', async () => {
    consentEnabled.mockResolvedValue(false);
    await run({ ...FORM, marketing_opt_in: 'on' });
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('an address that already has an account → nothing recorded', async () => {
    signUp.mockResolvedValue({ data: { user: { ...NEW_USER, identities: [] }, session: null }, error: null });
    const res = await signup(undefined, {}, fd({ ...FORM, marketing_opt_in: 'on' }));
    expect(res?.serverError).toContain('כבר רשומה');
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('a forged wording field is never passed on', async () => {
    await run({ ...FORM, marketing_opt_in: 'on', wording: 'זיוף', wording_version: '999' });
    const arg = recordConsent.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg)).not.toContain('wording');
    expect(Object.keys(arg)).not.toContain('wording_version');
  });

  it('a ledger failure does not fail the signup', async () => {
    recordConsent.mockRejectedValue(new Error('marketing_consent_write_failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run({ ...FORM, marketing_opt_in: 'on' });
  });
});

// The sales ref is a BOUND argument, validated by the schema's own `ref` rule. A posted `ref` field is not part of
// the form schema, so it can never stand in for the bound one.
describe('signup — the bound sales ref', () => {
  const FORM = {
    email: 'dana@example.com',
    password: 'aVeryGoodPass1!',
    full_name: 'דנה כהן',
    phone: '',
    terms_accepted: 'on',
  };

  beforeEach(() => {
    consentEnabled.mockResolvedValue(false);
    signUp.mockResolvedValue({
      data: { user: { id: 'new-user', email: FORM.email, identities: [{ id: 'i1' }] }, session: null },
      error: null,
    });
  });

  it('a posted `ref` field is ignored — no attribution travels to signUp', async () => {
    await expect(
      signup(undefined, {}, fd({ ...FORM, ref: '11111111-1111-4111-8111-111111111111' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    const options = signUp.mock.calls[0][0].options as { data: Record<string, unknown> };
    expect(options.data).not.toHaveProperty('sales_referral_attempt_id');
  });

  it('a malformed bound ref never fails the signup: it reads as no attribution and the signup goes ahead', async () => {
    await expect(signup('not-a-uuid', {}, fd(FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(signUp).toHaveBeenCalledTimes(1);
    const options = signUp.mock.calls[0][0].options as { data: Record<string, unknown> };
    expect(options.data).not.toHaveProperty('sales_referral_attempt_id');
  });
});
