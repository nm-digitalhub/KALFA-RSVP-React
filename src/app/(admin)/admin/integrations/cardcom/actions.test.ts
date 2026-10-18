import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveMock, revalidateMock } = vi.hoisted(() => ({ saveMock: vi.fn(), revalidateMock: vi.fn() }));
vi.mock('@/lib/data/admin/integrations/cardcom-config', () => ({ saveCardcomConfig: saveMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('next/navigation', () => ({ unstable_rethrow: (e: unknown) => { if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e; } }));

import { updateCardcomConfigAction } from './actions';

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const values: Record<string, string> = { terminal_number: '1001', api_name: 'kalfa-api', api_password: 'pw', enabled: 'on', google_pay_mode: 'off', ...over };
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
    expect(saveMock).toHaveBeenCalledWith({
      terminalNumber: 1001,
      apiName: 'kalfa-api',
      apiPassword: 'pw',
      documentReportSecret: '',
      enabled: true,
      saveCardOnPurchase: false,
      googlePayMode: 'off',
    });
    expect(state).toEqual({ notice: 'פרטי CardCom נשמרו' });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/integrations/cardcom');
    expect(revalidateMock).toHaveBeenCalledWith('/admin/integrations');
  });

  it('an unchecked box is false, and a blank password is passed on as blank (keep the stored one)', async () => {
    const f = form({ api_password: '' });
    f.delete('enabled');
    await updateCardcomConfigAction(null, f);
    expect(saveMock).toHaveBeenCalledWith({
      terminalNumber: 1001,
      apiName: 'kalfa-api',
      apiPassword: '',
      documentReportSecret: '',
      enabled: false,
      saveCardOnPurchase: false,
      googlePayMode: 'off',
    });
  });

  it('the save-card checkbox reaches the save as a boolean', async () => {
    await updateCardcomConfigAction(null, form({ save_card_on_purchase: 'on' }));
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ saveCardOnPurchase: true }));
  });

  it.each(['off', 'admins', 'all'])('the Google Pay position %s reaches the save as it was chosen', async (mode) => {
    await updateCardcomConfigAction(null, form({ google_pay_mode: mode }));
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ googlePayMode: mode }));
  });

  it.each([
    ['an unknown word', 'everyone'],
    ['a different case', 'ALL'],
    ['an empty choice', ''],
  ])('rejects %s for Google Pay without saving, never silently turning it off', async (_label, value) => {
    const state = await updateCardcomConfigAction(null, form({ google_pay_mode: value }));
    expect(state).toMatchObject({ fieldErrors: { google_pay_mode: [expect.any(String)] } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('rejects a submit that carries no Google Pay choice at all', async () => {
    const f = form();
    f.delete('google_pay_mode');
    const state = await updateCardcomConfigAction(null, f);
    expect(state).toMatchObject({ fieldErrors: { google_pay_mode: [expect.any(String)] } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it.each([
    ['terminal_number', 'abc'],
    ['terminal_number', '0'],
    ['terminal_number', '12345678901'],
    ['api_name', '   '],
    // CardCom does not URL-encode the extra string: only English letters and digits, 24 to 128 of them.
    ['document_report_secret', 'too-short'],
    ['document_report_secret', 'has space in it but is long enough'],
    ['document_report_secret', 'סודבעבריתסודבעבריתסודבעבריתסוד'],
  ])('rejects a bad %s (%s) without saving', async (field, value) => {
    const state = await updateCardcomConfigAction(null, form({ [field]: value }));
    expect(state).toMatchObject({ fieldErrors: { [field]: [expect.any(String)] } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('passes a valid document report secret on to the save', async () => {
    const secret = 'A1b2C3d4E5f6G7h8I9j0K1l2';
    await updateCardcomConfigAction(null, form({ document_report_secret: secret }));
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ documentReportSecret: secret }));
  });

  it('says why when the pilot cannot be switched on without a password', async () => {
    saveMock.mockResolvedValue({ ok: false, reason: 'password_required' });
    const state = await updateCardcomConfigAction(null, form({ api_password: '' }));
    expect(state).toMatchObject({ fieldErrors: { api_password: [expect.stringContaining('סיסמ')] } });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('logs only the database error code of a failed save, so the cause can be found without the form ever showing it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveMock.mockRejectedValue(Object.assign(new Error('permission denied for table cardcom_config'), { code: '42501', details: 'api_name=kalfa-api' }));
    await updateCardcomConfigAction(null, form({ api_password: 'typed-secret' }));
    expect(log).toHaveBeenCalledWith('[cardcom-config] save failed', { code: '42501' });
    const logged = JSON.stringify(log.mock.calls);
    for (const never of ['kalfa-api', 'typed-secret', 'permission denied']) expect(logged).not.toContain(never);
    saveMock.mockRejectedValue(new Error('no code at all'));
    await updateCardcomConfigAction(null, form());
    expect(log).toHaveBeenLastCalledWith('[cardcom-config] save failed', { code: 'none' });
    log.mockRestore();
  });

  it('answers a failed save with a safe message, never the error', async () => {
    saveMock.mockRejectedValue(new Error('vault exploded: secret-detail'));
    const state = await updateCardcomConfigAction(null, form());
    expect(state).toEqual({ error: 'שמירת פרטי CardCom נכשלה. נסו שוב.' });
    expect(JSON.stringify(state)).not.toContain('secret-detail');
  });
});
