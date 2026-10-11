import { beforeEach, describe, expect, it, vi } from 'vitest';

// getAppUrl is mocked to a deterministic /auth/confirm URL so the suite asserts
// the EXACT emailRedirectTo handed to updateUser — no server-only, no real
// APP_ORIGIN. server-only is stubbed as well (server modules in the import graph
// still reference it).
vi.mock('server-only', () => ({}));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ updateProfile: vi.fn() }));
vi.mock('@/lib/data/user-settings', () => ({ updateUserSettings: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: { current: new Headers() } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => requestHeaders.current) }));
vi.mock('@/lib/data/marketing-consent', () => ({ isMarketingConsentEnabled: vi.fn(), recordConsent: vi.fn() }));
vi.mock('@/lib/data/marketing-contact-sync', () => ({ enqueueMarketingContactSync: vi.fn() }));

import { logActivity } from '@/lib/data/activity';
import { updateProfile } from '@/lib/data/profiles';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/url';
import { requireUser } from '@/lib/auth/dal';
import { isMarketingConsentEnabled, recordConsent } from '@/lib/data/marketing-consent';
import { enqueueMarketingContactSync } from '@/lib/data/marketing-contact-sync';
import {
  requestEmailChangeAction,
  updateMarketingConsentAction,
  requestPhoneChangeAction,
  updateProfileAction,
  verifyPhoneChangeAction,
} from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('updateProfileAction — Next.js control-flow signals', () => {
  const FIELDS = { full_name: 'דנה', phone: '0501234567' };

  it('propagates a NEXT_REDIRECT from updateProfile (requireUser) instead of returning { error }', async () => {
    vi.mocked(updateProfile).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateProfileAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateProfile).mockRejectedValue(new Error('db down'));

    const result = await updateProfileAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'שמירת הפרטים נכשלה. נסו שוב.' });
  });
});

describe('requestEmailChangeAction — routes the confirmation through /auth/confirm', () => {
  const getUser = vi.fn();
  const updateUser = vi.fn();

  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser, updateUser } } as never);
    vi.mocked(getAppUrl).mockResolvedValue('https://beta.kalfa.me/auth/confirm');
    getUser.mockResolvedValue({ data: { user: { email: 'old@example.com' } } });
    updateUser.mockResolvedValue({ error: null });
  });

  it('calls updateUser with the new email AND emailRedirectTo=/auth/confirm, then returns a notice', async () => {
    const res = await requestEmailChangeAction(null, fd({ new_email: 'new@example.com' }));

    expect(getAppUrl).toHaveBeenCalledOnce();
    expect(getAppUrl).toHaveBeenCalledWith('/auth/confirm');
    expect(updateUser).toHaveBeenCalledOnce();
    expect(updateUser).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      { emailRedirectTo: 'https://beta.kalfa.me/auth/confirm' },
    );
    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity).toHaveBeenCalledWith({
      action: 'profile.email_change_requested',
      meta: { source: 'settings.account' },
    });
    expect(res).toEqual({
      notice:
        'נשלח קישור אישור לכתובת החדשה. כתובת המייל תתחלף רק לאחר שתאשרו דרך הקישור (וגם תאשרו בכתובת הנוכחית אם נדרש).',
    });
  });

  it('rejects changing to the SAME address (case-insensitive) — never calls updateUser', async () => {
    getUser.mockResolvedValue({ data: { user: { email: 'SAME@example.com' } } });

    const res = await requestEmailChangeAction(null, fd({ new_email: 'same@example.com' }));

    expect(getAppUrl).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(res).toEqual({ error: 'הכתובת החדשה זהה לכתובת הנוכחית.' });
  });

  it('returns a friendly error when updateUser fails', async () => {
    updateUser.mockResolvedValue({ error: { message: 'boom' } });

    const res = await requestEmailChangeAction(null, fd({ new_email: 'new@example.com' }));

    expect(logActivity).not.toHaveBeenCalled();
    expect(res).toEqual({ error: 'שליחת אישור המייל נכשלה. נסו שוב מאוחר יותר.' });
  });
});

describe('phone verification — the proof stays in Auth, profiles gets only the display phone', () => {
  const getUser = vi.fn();
  const updateUser = vi.fn();
  const verifyOtp = vi.fn();
  const update = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();

  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1' } as never);
    eq.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq });
    from.mockReturnValue({ update });
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser, updateUser, verifyOtp }, from } as never);
    updateUser.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
  });

  it('verify: Auth checks the code as a phone_change, then only profiles.phone is written', async () => {
    const res = await verifyPhoneChangeAction(null, fd({ phone: '050-123-4567', otp_code: '123456' }));

    expect(verifyOtp).toHaveBeenCalledWith({ phone: '+972501234567', token: '123456', type: 'phone_change' });
    expect(from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ phone: '+972501234567' });
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
    expect(res).toEqual({ notice: 'הטלפון אומת.' });
  });

  it('verify: a wrong code writes nothing', async () => {
    verifyOtp.mockResolvedValue({ error: { status: 403, code: 'otp_expired', message: 'x' } });

    const res = await verifyPhoneChangeAction(null, fd({ phone: '050-123-4567', otp_code: '123456' }));

    expect(from).not.toHaveBeenCalled();
    expect(res).toEqual({ fieldErrors: { otp_code: ['הקוד שגוי או פג תוקפו'] } });
  });

  it('request: a number Auth already holds as confirmed sends no code', async () => {
    getUser.mockResolvedValue({ data: { user: { phone: '972501234567', phone_confirmed_at: '2026-09-02T00:00:00Z' } } });

    const res = await requestPhoneChangeAction(null, fd({ phone: '050-123-4567' }));

    expect(updateUser).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ phone: '+972501234567' });
    expect(res).toEqual({ notice: 'המספר הזה כבר מאומת. לא נשלח קוד.' });
  });

  it('request: a new number asks Auth to send the code and writes nothing yet', async () => {
    getUser.mockResolvedValue({ data: { user: { phone: '972501234567', phone_confirmed_at: '2026-09-02T00:00:00Z' } } });

    const res = await requestPhoneChangeAction(null, fd({ phone: '052-999-8888' }));

    expect(updateUser).toHaveBeenCalledWith({ phone: '+972529998888' });
    expect(from).not.toHaveBeenCalled();
    expect(res).toEqual({ notice: 'קוד אימות נשלח בהודעת SMS למספר שהוזן.' });
  });
});

describe('updateMarketingConsentAction', () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: 'dana@example.com' } as never);
    vi.mocked(isMarketingConsentEnabled).mockResolvedValue(true);
    vi.mocked(recordConsent).mockResolvedValue('recorded');
    vi.mocked(enqueueMarketingContactSync).mockResolvedValue(undefined);
    requestHeaders.current = new Headers({ 'x-real-ip': '203.0.113.7', 'user-agent': 'UA/1' });
  });

  it('turned on → a grant for the session user, and a resubscribe sync', async () => {
    const res = await updateMarketingConsentAction(null, fd({ marketing_opt_in: 'on' }));
    expect(recordConsent).toHaveBeenCalledWith({
      userId: 'u-1',
      email: 'dana@example.com',
      action: 'grant',
      source: 'settings',
      ip: '203.0.113.7',
      userAgent: 'UA/1',
    });
    expect(enqueueMarketingContactSync).toHaveBeenCalledWith({ userId: 'u-1', resubscribe: true });
    expect(res?.notice).toBeTruthy();
  });

  it('turned off → a withdrawal, and a plain sync', async () => {
    await updateMarketingConsentAction(null, fd({}));
    expect(vi.mocked(recordConsent).mock.calls[0][0]).toMatchObject({ action: 'withdraw', source: 'settings' });
    expect(enqueueMarketingContactSync).toHaveBeenCalledWith({ userId: 'u-1' });
  });

  it('no change → nothing queued', async () => {
    vi.mocked(recordConsent).mockResolvedValue('unchanged');
    await updateMarketingConsentAction(null, fd({ marketing_opt_in: 'on' }));
    expect(enqueueMarketingContactSync).not.toHaveBeenCalled();
  });

  it('a queue failure still reports success — the reconcile catches it', async () => {
    vi.mocked(enqueueMarketingContactSync).mockRejectedValue(new Error('pgboss down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await updateMarketingConsentAction(null, fd({}));
    expect(res?.notice).toBeTruthy();
  });

  it('switched off → refused, nothing recorded', async () => {
    vi.mocked(isMarketingConsentEnabled).mockResolvedValue(false);
    const res = await updateMarketingConsentAction(null, fd({ marketing_opt_in: 'on' }));
    expect(res?.error).toBeTruthy();
    expect(recordConsent).not.toHaveBeenCalled();
  });
});
