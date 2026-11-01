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
import { updateUserSettings } from '@/lib/data/user-settings';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/url';
import { requireUser } from '@/lib/auth/dal';
import { isMarketingConsentEnabled, recordConsent } from '@/lib/data/marketing-consent';
import { enqueueMarketingContactSync } from '@/lib/data/marketing-contact-sync';
import {
  requestEmailChangeAction,
  updateMarketingConsentAction,
  requestPhoneChangeAction,
  sendPasswordResetAction,
  updateProfileAction,
  updateSettingsAction,
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
  // The profile form posts the display name only (settings-client ProfileSection).
  const FIELDS = { full_name: 'דנה' };

  it('propagates a NEXT_REDIRECT from updateProfile (requireUser) instead of returning { error }', async () => {
    vi.mocked(updateProfile).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateProfileAction({}, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateProfile).mockRejectedValue(new Error('db down'));

    const result = await updateProfileAction({}, fd(FIELDS));

    expect(result).toEqual({ serverError: 'שמירת הפרטים נכשלה. נסו שוב.' });
  });
});

describe('updateProfileAction — the form posts the name only', () => {
  it('saves the name and never sends a phone, so profiles.phone keeps the proved number', async () => {
    vi.mocked(updateProfile).mockResolvedValue({} as never);

    const result = await updateProfileAction({}, fd({ full_name: 'דנה כהן' }));

    expect(result).toEqual({ data: { notice: 'הפרטים נשמרו' } });
    expect(updateProfile).toHaveBeenCalledWith({ full_name: 'דנה כהן' });
  });

  it('an empty name clears it', async () => {
    vi.mocked(updateProfile).mockResolvedValue({} as never);

    await updateProfileAction({}, fd({ full_name: '' }));

    expect(updateProfile).toHaveBeenCalledWith({ full_name: null });
  });

  it('a name over the limit gets the Hebrew field message and saves nothing', async () => {
    const result = await updateProfileAction({}, fd({ full_name: 'א'.repeat(500) }));

    expect(result.validationErrors?.fieldErrors.full_name).toEqual(['השם ארוך מדי']);
    expect(updateProfile).not.toHaveBeenCalled();
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
    const res = await requestEmailChangeAction({}, fd({ new_email: 'new@example.com' }));

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
      data: {
        notice:
          'נשלח קישור אישור לכתובת החדשה. כתובת המייל תתחלף רק לאחר שתאשרו דרך הקישור (וגם תאשרו בכתובת הנוכחית אם נדרש).',
      },
    });
  });

  it('rejects changing to the SAME address (case-insensitive) — never calls updateUser', async () => {
    getUser.mockResolvedValue({ data: { user: { email: 'SAME@example.com' } } });

    const res = await requestEmailChangeAction({}, fd({ new_email: 'same@example.com' }));

    expect(getAppUrl).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(res).toEqual({ serverError: 'הכתובת החדשה זהה לכתובת הנוכחית.' });
  });

  it('returns a friendly error when updateUser fails', async () => {
    updateUser.mockResolvedValue({ error: { message: 'boom' } });

    const res = await requestEmailChangeAction({}, fd({ new_email: 'new@example.com' }));

    expect(logActivity).not.toHaveBeenCalled();
    expect(res).toEqual({ serverError: 'שליחת אישור המייל נכשלה. נסו שוב מאוחר יותר.' });
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
    const res = await verifyPhoneChangeAction({}, fd({ phone: '050-123-4567', otp_code: '123456' }));

    expect(verifyOtp).toHaveBeenCalledWith({ phone: '+972501234567', token: '123456', type: 'phone_change' });
    expect(from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ phone: '+972501234567' });
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
    expect(res).toEqual({ data: { notice: 'הטלפון אומת.' } });
  });

  it('verify: a wrong code writes nothing', async () => {
    verifyOtp.mockResolvedValue({ error: { status: 403, code: 'otp_expired', message: 'x' } });

    const res = await verifyPhoneChangeAction({}, fd({ phone: '050-123-4567', otp_code: '123456' }));

    expect(from).not.toHaveBeenCalled();
    expect(res).toEqual({ validationErrors: { formErrors: [], fieldErrors: { otp_code: ['הקוד שגוי או פג תוקפו'] } } });
  });

  it('request: a number Auth already holds as confirmed sends no code', async () => {
    getUser.mockResolvedValue({ data: { user: { phone: '972501234567', phone_confirmed_at: '2026-09-02T00:00:00Z' } } });

    const res = await requestPhoneChangeAction({}, fd({ phone: '050-123-4567' }));

    expect(updateUser).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ phone: '+972501234567' });
    expect(res).toEqual({ data: { notice: 'המספר הזה כבר מאומת. לא נשלח קוד.' } });
  });

  it('request: a new number asks Auth to send the code and writes nothing yet', async () => {
    getUser.mockResolvedValue({ data: { user: { phone: '972501234567', phone_confirmed_at: '2026-09-02T00:00:00Z' } } });

    const res = await requestPhoneChangeAction({}, fd({ phone: '052-999-8888' }));

    expect(updateUser).toHaveBeenCalledWith({ phone: '+972529998888' });
    expect(from).not.toHaveBeenCalled();
    expect(res).toEqual({ data: { notice: 'קוד אימות נשלח בהודעת SMS למספר שהוזן.' } });
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
    const res = await updateMarketingConsentAction({}, fd({ marketing_opt_in: 'on' }));
    expect(recordConsent).toHaveBeenCalledWith({
      userId: 'u-1',
      email: 'dana@example.com',
      action: 'grant',
      source: 'settings',
      ip: '203.0.113.7',
      userAgent: 'UA/1',
    });
    expect(enqueueMarketingContactSync).toHaveBeenCalledWith({ userId: 'u-1', resubscribe: true });
    expect(res?.data?.notice).toBeTruthy();
  });

  it('turned off → a withdrawal, and a plain sync', async () => {
    await updateMarketingConsentAction({}, fd({}));
    expect(vi.mocked(recordConsent).mock.calls[0][0]).toMatchObject({ action: 'withdraw', source: 'settings' });
    expect(enqueueMarketingContactSync).toHaveBeenCalledWith({ userId: 'u-1' });
  });

  it('no change → nothing queued', async () => {
    vi.mocked(recordConsent).mockResolvedValue('unchanged');
    await updateMarketingConsentAction({}, fd({ marketing_opt_in: 'on' }));
    expect(enqueueMarketingContactSync).not.toHaveBeenCalled();
  });

  it('a queue failure still reports success — the reconcile catches it', async () => {
    vi.mocked(enqueueMarketingContactSync).mockRejectedValue(new Error('pgboss down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await updateMarketingConsentAction({}, fd({}));
    expect(res?.data?.notice).toBeTruthy();
  });

  it('switched off → refused, nothing recorded', async () => {
    vi.mocked(isMarketingConsentEnabled).mockResolvedValue(false);
    const res = await updateMarketingConsentAction({}, fd({ marketing_opt_in: 'on' }));
    expect(res?.serverError).toBeTruthy();
    expect(recordConsent).not.toHaveBeenCalled();
  });
});

// What the old actions answered for a bad input or a refusal reaches the form as the same Hebrew text: a field's
// message from the input schema, a refusal as serverError (raised outside the catch that would replace it).
describe('settings actions — the same Hebrew for a bad input or a refusal', () => {
  const getUser = vi.fn();
  const updateUser = vi.fn();
  const verifyOtp = vi.fn();
  const resetPasswordForEmail = vi.fn();

  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser, updateUser, verifyOtp, resetPasswordForEmail },
    } as never);
    vi.mocked(getAppUrl).mockResolvedValue('https://beta.kalfa.me/auth/confirm');
    getUser.mockResolvedValue({ data: { user: { email: 'old@example.com' } } });
  });

  it.each(['', 'abc', '123'])('request: refuses the phone %j under the field, and asks Auth for nothing', async (phone) => {
    const res = await requestPhoneChangeAction({}, fd({ phone }));

    expect(res).toEqual({ validationErrors: { formErrors: [], fieldErrors: { phone: ['מספר טלפון לא תקין'] } } });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('request: an Auth refusal is the fixed message', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    updateUser.mockResolvedValue({ error: { status: 422, code: 'x', message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await requestPhoneChangeAction({}, fd({ phone: '052-999-8888' }));

    expect(res).toEqual({ serverError: 'שליחת קוד האימות נכשלה. בדקו את המספר ונסו שוב.' });
  });

  it.each(['', '12345', 'abcdef'])('verify: refuses the code %j under the field, and verifies nothing', async (otp_code) => {
    const res = await verifyPhoneChangeAction({}, fd({ phone: '050-123-4567', otp_code }));

    expect(res).toEqual({ validationErrors: { formErrors: [], fieldErrors: { otp_code: ['יש להזין קוד בן 6 ספרות'] } } });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('email: refuses a malformed address under the field', async () => {
    const res = await requestEmailChangeAction({}, fd({ new_email: 'not-an-email' }));

    expect(res).toEqual({ validationErrors: { formErrors: [], fieldErrors: { new_email: ['כתובת אימייל לא תקינה'] } } });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('email: a thrown failure is the catch’s fixed message', async () => {
    getUser.mockRejectedValue(new Error('network down'));

    const res = await requestEmailChangeAction({}, fd({ new_email: 'new@example.com' }));

    expect(res).toEqual({ serverError: 'שליחת אישור המייל נכשלה. נסו שוב.' });
  });

  it('password reset: an account without an email is told so, not the generic failure', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: undefined } as never);

    const res = await sendPasswordResetAction({}, new FormData());

    expect(res).toEqual({ serverError: 'לא נמצאה כתובת אימייל לחשבון.' });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('password reset: an Auth refusal is the fixed message, and nothing is logged', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: 'dana@example.com' } as never);
    resetPasswordForEmail.mockResolvedValue({ error: { message: 'x' } });

    const res = await sendPasswordResetAction({}, new FormData());

    expect(res).toEqual({ serverError: 'שליחת קישור איפוס הסיסמה נכשלה. נסו שוב.' });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('password reset: sent, logged, and the notice', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: 'dana@example.com' } as never);
    resetPasswordForEmail.mockResolvedValue({ error: null });

    const res = await sendPasswordResetAction({}, new FormData());

    expect(resetPasswordForEmail).toHaveBeenCalledWith('dana@example.com');
    expect(logActivity).toHaveBeenCalledWith({ action: 'password.reset_requested', meta: { source: 'settings.security' } });
    expect(res).toEqual({ data: { notice: 'נשלח קישור איפוס סיסמה לאימייל שלכם.' } });
  });

  it('marketing consent: the switched-off and no-email refusals keep their text', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: 'dana@example.com' } as never);
    vi.mocked(isMarketingConsentEnabled).mockResolvedValue(false);
    expect(await updateMarketingConsentAction({}, fd({}))).toEqual({ serverError: 'האפשרות אינה זמינה כרגע.' });

    vi.mocked(isMarketingConsentEnabled).mockResolvedValue(true);
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: undefined } as never);
    expect(await updateMarketingConsentAction({}, fd({}))).toEqual({ serverError: 'לחשבון אין כתובת אימייל.' });
    expect(recordConsent).not.toHaveBeenCalled();
  });
});

describe('updateSettingsAction — the toggles as posted', () => {
  it('a checked box (posted) is on, an unchecked one (absent) is off', async () => {
    const res = await updateSettingsAction({}, fd({ event_updates: 'on' }));

    expect(updateUserSettings).toHaveBeenCalledWith({
      event_updates: true,
      reminder_updates: false,
      billing_updates: false,
    });
    expect(res).toEqual({ data: { notice: 'ההעדפות נשמרו' } });
  });

  it('a failed save is the fixed message', async () => {
    vi.mocked(updateUserSettings).mockRejectedValue(new Error('db down'));

    const res = await updateSettingsAction({}, fd({}));

    expect(res).toEqual({ serverError: 'שמירת ההעדפות נכשלה. נסו שוב.' });
  });
});

describe('updateMarketingConsentAction — the checks run before the choice is read', () => {
  it('switched off answers the same refusal whatever the form posts', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u-1', email: 'dana@example.com' } as never);
    vi.mocked(isMarketingConsentEnabled).mockResolvedValue(false);

    const res = await updateMarketingConsentAction({}, fd({ marketing_opt_in: 'yes' }));

    expect(res).toEqual({ serverError: 'האפשרות אינה זמינה כרגע.' });
    expect(recordConsent).not.toHaveBeenCalled();
  });
});
