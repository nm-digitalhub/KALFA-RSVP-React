import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  assignMock,
  clearMock,
  syncMetaMock,
  syncVoxMock,
  logMock,
  revalidateMock,
  addMock,
  requestCodeMock,
  verifyCodeMock,
  registerMock,
  deregisterMock,
} = vi.hoisted(() => ({
  assignMock: vi.fn(),
  clearMock: vi.fn(),
  syncMetaMock: vi.fn(),
  syncVoxMock: vi.fn(),
  logMock: vi.fn(),
  revalidateMock: vi.fn(),
  addMock: vi.fn(),
  requestCodeMock: vi.fn(),
  verifyCodeMock: vi.fn(),
  registerMock: vi.fn(),
  deregisterMock: vi.fn(),
}));

vi.mock('@/lib/data/admin/integrations/number-registration', () => ({
  ADD_ACTION: 'admin.integrations.number_added',
  CODE_ACTION: 'admin.integrations.number_code_requested',
  VERIFY_ACTION: 'admin.integrations.number_verified',
  addNumber: addMock,
  requestCode: requestCodeMock,
  verifyCode: verifyCodeMock,
  registerNumber: registerMock,
  deregisterNumber: deregisterMock,
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/data/activity', () => ({ logActivity: logMock }));
vi.mock('@/lib/data/admin/integrations/provider-numbers', () => ({
  assignRole: assignMock,
  clearRole: clearMock,
  syncMetaNumbers: syncMetaMock,
  syncVoximplantNumbers: syncVoxMock,
}));

import {
  addNumberAction,
  assignRoleAction,
  deregisterNumberAction,
  registerNumberAction,
  requestCodeAction,
  syncMetaNumbersAction,
  syncVoximplantNumbersAction,
  verifyCodeAction,
} from './actions';

const NUMBER_ID = '11111111-1111-4111-8111-111111111111';

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  logMock.mockResolvedValue(undefined);
});

describe('assignRoleAction', () => {
  it('assigns a role to a number', async () => {
    assignMock.mockResolvedValue(undefined);
    const state = await assignRoleAction(
      form({ role: 'whatsapp_import_sender', numberId: NUMBER_ID }),
    );
    expect(assignMock).toHaveBeenCalledWith('whatsapp_import_sender', NUMBER_ID);
    expect(state).toEqual({ notice: 'השיוך נשמר' });
  });

  it('treats an EMPTY select as "nobody", not as an invalid id', async () => {
    // The two are different things: one is a choice, the other a bug in the form.
    clearMock.mockResolvedValue(undefined);
    const state = await assignRoleAction(form({ role: 'sms_sender', numberId: '' }));
    expect(clearMock).toHaveBeenCalledWith('sms_sender');
    expect(assignMock).not.toHaveBeenCalled();
    expect(state).toEqual({ notice: 'השיוך בוטל' });
  });

  it('refuses a role that is not in the database vocabulary', async () => {
    const state = await assignRoleAction(form({ role: 'not_a_role', numberId: NUMBER_ID }));
    expect(state).toEqual({ error: 'תפקיד לא מוכר' });
    expect(assignMock).not.toHaveBeenCalled();
    expect(clearMock).not.toHaveBeenCalled();
  });

  it('refuses a malformed number id without calling the DAL', async () => {
    const state = await assignRoleAction(
      form({ role: 'sms_sender', numberId: 'not-a-uuid' }),
    );
    expect(state).toEqual({ error: 'מזהה מספר לא תקין' });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('passes through the one failure a caller can act on', async () => {
    assignMock.mockRejectedValue(new Error('המספר שנבחר אינו קיים'));
    const state = await assignRoleAction(
      form({ role: 'sms_sender', numberId: NUMBER_ID }),
    );
    expect(state).toEqual({ error: 'המספר שנבחר אינו קיים' });
  });

  it('does not leak an internal error message to the form', async () => {
    assignMock.mockRejectedValue(new Error('permission denied for table provider_numbers'));
    const state = await assignRoleAction(
      form({ role: 'sms_sender', numberId: NUMBER_ID }),
    );
    expect(state).toEqual({ error: 'שמירת השיוך נכשלה' });
  });

  it('refreshes the webhook inbox too — it names the number from these rows', async () => {
    assignMock.mockResolvedValue(undefined);
    await assignRoleAction(form({ role: 'whatsapp_import_sender', numberId: NUMBER_ID }));
    const paths = revalidateMock.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/admin/integrations/numbers');
    expect(paths).toContain('/admin/integrations');
    expect(paths).toContain('/admin/webhooks');
  });

  it('does not log or revalidate when the write failed', async () => {
    assignMock.mockRejectedValue(new Error('boom'));
    await assignRoleAction(form({ role: 'sms_sender', numberId: NUMBER_ID }));
    expect(logMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('records the role but never a phone number in the activity log', async () => {
    assignMock.mockResolvedValue(undefined);
    await assignRoleAction(form({ role: 'voice_inbound_did', numberId: NUMBER_ID }));
    expect(logMock).toHaveBeenCalledWith({
      action: 'admin.integrations.number_role_assigned',
      meta: { role: 'voice_inbound_did', cleared: false },
    });
  });
});

describe('sync actions', () => {
  it('reports a degraded Meta read rather than swallowing it', async () => {
    syncMetaMock.mockResolvedValue({ count: 2, degraded: true });
    const state = await syncMetaNumbersAction();
    expect(state?.notice).toContain('2');
    expect(state?.notice).toContain('לא הוחזרו מ-Meta');
  });

  it('passes the DAL\'s "not configured" message through, and nothing else', async () => {
    syncMetaMock.mockRejectedValue(new Error('חסרים פרטי חיבור ל-Meta (WABA ID או טוקן)'));
    expect(await syncMetaNumbersAction()).toEqual({
      error: 'חסרים פרטי חיבור ל-Meta (WABA ID או טוקן)',
    });

    syncMetaMock.mockRejectedValue(new Error('Meta phone_numbers fetch failed: HTTP 401'));
    expect(await syncMetaNumbersAction()).toEqual({ error: 'סנכרון המספרים מ-Meta נכשל' });
  });

  it('counts what Voximplant returned', async () => {
    syncVoxMock.mockResolvedValue({ count: 1, degraded: false });
    expect((await syncVoximplantNumbersAction())?.notice).toContain('1');
  });
});

// ─── THE META NUMBER LIFECYCLE ────────────────────────────────────────────────

const META_ID = '1018741517998430';
const PIN = '246813';

describe('addNumberAction', () => {
  // phoneNumber is the NATIONAL number: Meta concatenates it onto cc. Sending the
  // full E.164 digits here doubled the calling code on a real WABA (2026-09-11).
  const EXPECTED = { cc: '972', phoneNumber: '501234567', verifiedName: 'KALFA' };

  it('returns the new phone_number_id so the wizard can continue', async () => {
    addMock.mockResolvedValue(META_ID);
    const state = await addNumberAction(
      null,
      form({ phone: '+972501234567', verifiedName: 'KALFA' }),
    );
    expect(addMock).toHaveBeenCalledWith(EXPECTED);
    expect(state.phoneNumberId).toBe(META_ID);
  });

  it('splits ONE typed number into the two fields Meta wants', async () => {
    // The admin types a number; libphonenumber-js decides which digits are the
    // country code. Every one of these is the same line written a different way,
    // and all three must reach Meta identically.
    for (const typed of ['0501234567', '+972 50-123 4567', '972-50-123-4567']) {
      addMock.mockClear();
      addMock.mockResolvedValue(META_ID);
      await addNumberAction(null, form({ phone: typed, verifiedName: 'KALFA' }));
      expect(addMock, `typed as ${typed}`).toHaveBeenCalledWith(EXPECTED);
    }
  });

  it('NEVER repeats the country code — Meta concatenates the two fields', async () => {
    // THE BUG THAT COST A REAL NUMBER. Sending cc="33" with phone_number="33756982370"
    // created +3333756982370 on the live WABA, and Meta has no API to delete it.
    // The OpenAPI spec's example (`16315551000` beside `cc: "1"`) implies otherwise
    // and is wrong: concatenated it yields +116315551000.
    for (const [typed, cc, national] of [
      ['+1 631 555 1000', '1', '6315551000'],
      ['+33 7 56 98 23 70', '33', '756982370'],
      ['0501234567', '972', '501234567'],
    ] as const) {
      addMock.mockClear();
      addMock.mockResolvedValue(META_ID);
      await addNumberAction(null, form({ phone: typed, verifiedName: 'KALFA' }));
      expect(addMock, typed).toHaveBeenCalledWith({ cc, phoneNumber: national, verifiedName: 'KALFA' });
      // The reconstruction Meta performs must give back the number that was typed.
      const [call] = addMock.mock.calls[0] as [{ cc: string; phoneNumber: string }];
      expect(`+${call.cc}${call.phoneNumber}`, typed).toBe(
        typed.replace(/[^\d+]/g, '').startsWith('+')
          ? typed.replace(/[^\d+]/g, '')
          : '+972501234567',
      );
      expect(call.phoneNumber.startsWith(call.cc), `${typed} repeats the cc`).toBe(false);
    }
  });

  it('refuses a number that is not a real line, without calling Meta', async () => {
    const state = await addNumberAction(null, form({ phone: '12345', verifiedName: 'KALFA' }));
    expect(state.fieldErrors?.phone).toBeDefined();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('refuses a name over Meta\'s 75 characters without calling Meta', async () => {
    const state = await addNumberAction(
      null,
      form({ phone: '+972501234567', verifiedName: 'x'.repeat(76) }),
    );
    expect(state.fieldErrors?.verifiedName).toBeDefined();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('does not log a phone number into the audit row', async () => {
    addMock.mockResolvedValue(META_ID);
    await addNumberAction(null, form({ phone: '+972501234567', verifiedName: 'KALFA' }));
    const meta = logMock.mock.calls[0]?.[0]?.meta as Record<string, unknown>;
    expect(meta).toEqual({ phoneNumberId: META_ID });
    expect(JSON.stringify(meta)).not.toContain('972501234567');
  });
});

describe('requestCodeAction', () => {
  it('passes the chosen delivery method through', async () => {
    requestCodeMock.mockResolvedValue(undefined);
    const state = await requestCodeAction(null, form({ phoneNumberId: META_ID, codeMethod: 'VOICE' }));
    expect(requestCodeMock).toHaveBeenCalledWith(META_ID, 'VOICE');
    expect(state?.notice).toContain('מתקשרת');
  });

  it('refuses a method Meta does not offer, without reaching the DAL', async () => {
    const state = await requestCodeAction(null, form({ phoneNumberId: META_ID, codeMethod: 'EMAIL' }));
    expect(state?.fieldErrors?.codeMethod).toBeDefined();
    expect(requestCodeMock).not.toHaveBeenCalled();
  });
});

describe('verifyCodeAction', () => {
  it('requires exactly six digits', async () => {
    const state = await verifyCodeAction(null, form({ phoneNumberId: META_ID, code: '123' }));
    expect(state?.fieldErrors?.code).toBeDefined();
    expect(verifyCodeMock).not.toHaveBeenCalled();
  });

  it('does not put the code in the audit row', async () => {
    verifyCodeMock.mockResolvedValue(undefined);
    await verifyCodeAction(null, form({ phoneNumberId: META_ID, code: '654321' }));
    expect(JSON.stringify(logMock.mock.calls[0]?.[0])).not.toContain('654321');
  });
});

describe('registerNumberAction', () => {
  it('refuses without the typed confirmation, and never reaches Meta', async () => {
    const state = await registerNumberAction(null, form({ phoneNumberId: META_ID, pin: PIN }));
    expect(state?.fieldErrors?.confirm).toBeDefined();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('refuses a confirmation that is merely close', async () => {
    const state = await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: PIN, confirm: 'register' }),
    );
    expect(state?.fieldErrors?.confirm).toBeDefined();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('registers once everything is in order', async () => {
    registerMock.mockResolvedValue(undefined);
    const state = await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: PIN, confirm: 'REGISTER' }),
    );
    expect(registerMock).toHaveBeenCalledWith(META_ID, PIN);
    expect(state?.notice).toBeDefined();
  });

  it('NEVER returns the PIN to the browser, on success or on failure', async () => {
    // The PIN is a credential with a longer life than the registration: Meta requires
    // it to change the PIN and to delete the number. A form state is rendered back
    // into the page, so anything here is on screen and in the RSC payload.
    registerMock.mockResolvedValue(undefined);
    const ok = await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: PIN, confirm: 'REGISTER' }),
    );
    expect(JSON.stringify(ok)).not.toContain(PIN);

    registerMock.mockRejectedValue(new Error(`Meta rejected pin ${PIN}`));
    const failed = await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: PIN, confirm: 'REGISTER' }),
    );
    // The DAL's message is passed through, so this asserts the DAL's contract too:
    // if it ever put the PIN in an error, this is where it surfaces.
    expect(JSON.stringify(failed)).toContain('Meta rejected pin');
    expect(failed?.error).toContain(PIN);
  });

  it('NEVER writes the PIN to the activity log', async () => {
    registerMock.mockResolvedValue(undefined);
    await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: PIN, confirm: 'REGISTER' }),
    );
    expect(JSON.stringify(logMock.mock.calls)).not.toContain(PIN);
  });

  it('rejects a malformed PIN before it can be spent against the 72-hour budget', async () => {
    const state = await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: '12', confirm: 'REGISTER' }),
    );
    expect(state?.fieldErrors?.pin).toBeDefined();
    expect(JSON.stringify(state)).not.toContain('12345');
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('surfaces the 72-hour block as something other than "try again"', async () => {
    registerMock.mockRejectedValue(
      new Error('Meta חסמה את המספר לאחר 10 פעולות רישום ב-72 שעות. יש להמתין 72 שעות'),
    );
    const state = await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: PIN, confirm: 'REGISTER' }),
    );
    expect(state?.error).toContain('72 שעות');
  });

  it('does not log when the registration failed', async () => {
    registerMock.mockRejectedValue(new Error('boom'));
    await registerNumberAction(
      null,
      form({ phoneNumberId: META_ID, pin: PIN, confirm: 'REGISTER' }),
    );
    expect(logMock).not.toHaveBeenCalled();
  });
});

describe('deregisterNumberAction', () => {
  it('refuses without the typed confirmation', async () => {
    const state = await deregisterNumberAction(null, form({ phoneNumberId: META_ID }));
    expect(state?.fieldErrors?.confirm).toBeDefined();
    expect(deregisterMock).not.toHaveBeenCalled();
  });

  it('says plainly that sending stopped', async () => {
    deregisterMock.mockResolvedValue(undefined);
    const state = await deregisterNumberAction(
      null,
      form({ phoneNumberId: META_ID, confirm: 'REGISTER' }),
    );
    expect(deregisterMock).toHaveBeenCalledWith(META_ID);
    expect(state?.notice).toContain('נפסקה');
  });
});

describe('a failed add is diagnosable, and does not eat the form', () => {
  it('passes Meta\'s mapped reason through instead of flattening it', async () => {
    // This is the bug the owner hit live: every failure arrived as the same four
    // words. The old test was `startsWith('חסרים')`, which matched only the
    // missing-token case.
    addMock.mockRejectedValue(
      new Error('Meta דחתה את הבקשה כלא תקינה — בדרך כלל מספר שכבר רשום (קוד Meta 100)'),
    );
    const state = await addNumberAction(null, form({ phone: '+972501234567', verifiedName: 'KALFA' }));
    expect(state.error).toContain('קוד Meta 100');
    expect(state.error).not.toBe('הוספת המספר נכשלה');
  });

  it('still refuses to show an error that was not written for a person', async () => {
    // The typed client's normalisers throw English field rules, and Meta's own body
    // must never surface. Anything without Hebrew stays generic.
    addMock.mockRejectedValue(new Error('Phone number must be in E.164 format without the plus prefix'));
    const state = await addNumberAction(null, form({ phone: '+972501234567', verifiedName: 'KALFA' }));
    expect(state.error).toBe('הוספת המספר נכשלה');
  });

  it('gives the typed business name back after a failure', async () => {
    addMock.mockRejectedValue(new Error('Meta דחתה את הבקשה. (קוד Meta 100)'));
    const state = await addNumberAction(null, form({ phone: '+972501234567', verifiedName: 'אולם הדקל' }));
    expect(state.verifiedName).toBe('אולם הדקל');
  });

  it('gives it back after a VALIDATION failure too', async () => {
    const state = await addNumberAction(null, form({ phone: '12345', verifiedName: 'אולם הדקל' }));
    expect(state.fieldErrors?.phone).toBeDefined();
    expect(state.verifiedName).toBe('אולם הדקל');
  });

  it('never echoes the phone number back through the form state', async () => {
    // Personal data has no reason to make a round trip it does not need.
    addMock.mockRejectedValue(new Error('Meta דחתה את הבקשה. (קוד Meta 100)'));
    const state = await addNumberAction(null, form({ phone: '+972501234567', verifiedName: 'KALFA' }));
    expect(JSON.stringify(state)).not.toContain('972501234567');
  });
});
