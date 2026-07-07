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

const { getUser, updateUser } = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser, updateUser, resetPasswordForEmail: vi.fn() },
  })),
}));

import { updatePassword } from './actions';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const VALID = { password: 'aVeryGoodPass1', confirm: 'aVeryGoodPass1' };

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  updateUser.mockResolvedValue({ error: null });
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
      fd({ password: 'aVeryGoodPass1', confirm: 'different12345' }),
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
