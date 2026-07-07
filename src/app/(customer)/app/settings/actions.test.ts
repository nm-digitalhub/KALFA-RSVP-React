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

import { logActivity } from '@/lib/data/activity';
import { updateProfile } from '@/lib/data/profiles';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/url';
import { requestEmailChangeAction, updateProfileAction } from './actions';

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
