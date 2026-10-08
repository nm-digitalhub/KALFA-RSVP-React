import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveMock, revalidateMock } = vi.hoisted(() => ({ saveMock: vi.fn(), revalidateMock: vi.fn() }));
vi.mock('@/lib/data/admin/integrations/cardcom-config', () => ({ saveCardcomConfig: saveMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('next/navigation', () => ({ unstable_rethrow: (e: unknown) => { if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e; } }));

import { updateCardcomConfigAction } from './actions';

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const values: Record<string, string> = { terminal_number: '1001', api_name: 'kalfa-api', api_password: 'pw', enabled: 'on', ...over };
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockResolvedValue({ ok: true });
});

describe('updateCardcomConfigAction', () => {
  it('validates, saves with the terminal as a number and the checkbox as a boolean, and revalidates both pages', async () => {
    const state = await updateCardcomConfigAction(null, form());
    expect(saveMock).toHaveBeenCalledWith({ terminalNumber: 1001, apiName: 'kalfa-api', apiPassword: 'pw', enabled: true });
    expect(state).toEqual({ notice: 'פרטי CardCom נשמרו' });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/integrations/cardcom');
    expect(revalidateMock).toHaveBeenCalledWith('/admin/integrations');
  });

  it('an unchecked box is false, and a blank password is passed on as blank (keep the stored one)', async () => {
    const f = form({ api_password: '' });
    f.delete('enabled');
    await updateCardcomConfigAction(null, f);
    expect(saveMock).toHaveBeenCalledWith({ terminalNumber: 1001, apiName: 'kalfa-api', apiPassword: '', enabled: false });
  });

  it.each([
    ['terminal_number', 'abc'],
    ['terminal_number', '0'],
    ['terminal_number', '12345678901'],
    ['api_name', '   '],
  ])('rejects a bad %s (%s) without saving', async (field, value) => {
    const state = await updateCardcomConfigAction(null, form({ [field]: value }));
    expect(state).toMatchObject({ fieldErrors: { [field]: [expect.any(String)] } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('says why when the pilot cannot be switched on without a password', async () => {
    saveMock.mockResolvedValue({ ok: false, reason: 'password_required' });
    const state = await updateCardcomConfigAction(null, form({ api_password: '' }));
    expect(state).toMatchObject({ fieldErrors: { api_password: [expect.stringContaining('סיסמ')] } });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('answers a failed save with a safe message, never the error', async () => {
    saveMock.mockRejectedValue(new Error('vault exploded: secret-detail'));
    const state = await updateCardcomConfigAction(null, form());
    expect(state).toEqual({ error: 'שמירת פרטי CardCom נכשלה. נסו שוב.' });
    expect(JSON.stringify(state)).not.toContain('secret-detail');
  });
});
