import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/exchange-connections', () => ({
  createExchangeConnection: vi.fn(),
  createMyExchangeTestAppointment: vi.fn(),
  deleteMyExchangeTestAppointment: vi.fn(),
  listMyExchangeCalendars: vi.fn(),
  revokeExchangeConnection: vi.fn(),
  testMyExchangeConnection: vi.fn(),
}));

import { revalidatePath } from 'next/cache';

import { actionErrorMessage } from '@/lib/action-result';
import {
  createExchangeConnection,
  createMyExchangeTestAppointment,
  deleteMyExchangeTestAppointment,
  listMyExchangeCalendars,
  revokeExchangeConnection,
  testMyExchangeConnection,
} from '@/lib/data/exchange-connections';

import {
  createExchangeConnectionAction,
  createExchangeTestAppointmentAction,
  deleteExchangeTestAppointmentAction,
  listExchangeCalendarsAction,
  revokeExchangeConnectionAction,
  testExchangeConnectionAction,
} from './exchange-actions';

// The permission checks live in the data layer (src/lib/data/exchange-connections.ts); these actions turn a form into
// its input and an outcome into a message.

const CONNECTION = '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'mailbox-password-123';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('createExchangeConnectionAction', () => {
  it('creates the connection from the trimmed address and the password, and never sends the password back', async () => {
    vi.mocked(createExchangeConnection).mockResolvedValueOnce({ ok: true } as never);

    const result = await createExchangeConnectionAction({}, fd({ mailboxEmail: ' owner@kalfa.me ', password: PASSWORD }));

    expect(createExchangeConnection).toHaveBeenCalledWith({ mailboxEmail: 'owner@kalfa.me', password: PASSWORD });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
    expect(result).toEqual({ data: { notice: 'החיבור נוצר. לחצו על "בדיקת חיבור" כדי לאמת אותו.' } });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('shows a refusal of the data layer in its own words', async () => {
    vi.mocked(createExchangeConnection).mockResolvedValueOnce({
      ok: false,
      error: 'מצב החיבור המשותף (ארגוני) פעיל, אך אינכם משויכים לארגון פעיל.',
    } as never);

    const result = await createExchangeConnectionAction({}, fd({ mailboxEmail: 'owner@kalfa.me', password: PASSWORD }));

    expect(result).toEqual({ serverError: 'מצב החיבור המשותף (ארגוני) פעיל, אך אינכם משויכים לארגון פעיל.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('answers a failure with the fixed line, without the error text or the password', async () => {
    vi.mocked(createExchangeConnection).mockRejectedValueOnce(new Error(`connect failed for ${PASSWORD}`));

    const result = await createExchangeConnectionAction({}, fd({ mailboxEmail: 'owner@kalfa.me', password: PASSWORD }));

    expect(result).toEqual({ serverError: 'יצירת חיבור ה-Exchange נכשלה. נסו שוב.' });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('refuses an address that is not an email with its Hebrew message', async () => {
    const result = await createExchangeConnectionAction({}, fd({ mailboxEmail: 'owner', password: '' }));

    expect(result.validationErrors?.fieldErrors?.mailboxEmail).toEqual(['כתובת אימייל לא תקינה']);
    expect(createExchangeConnection).not.toHaveBeenCalled();
  });

  it('connects from the form on /admin/settings, which has no password field (Graph signs in with a certificate)', async () => {
    vi.mocked(createExchangeConnection).mockResolvedValue({ ok: true, id: 'c-1' });

    const result = await createExchangeConnectionAction({}, fd({ mailboxEmail: 'owner@kalfa.me' }));

    expect(createExchangeConnection).toHaveBeenCalledWith({ mailboxEmail: 'owner@kalfa.me' });
    expect(result.data?.notice).toBe('החיבור נוצר. לחצו על "בדיקת חיבור" כדי לאמת אותו.');
  });
});

describe('testExchangeConnectionAction / listExchangeCalendarsAction / revokeExchangeConnectionAction', () => {
  it('reports the check as the data layer words it, success or not', async () => {
    vi.mocked(testMyExchangeConnection).mockResolvedValueOnce({ ok: true, message: 'החיבור תקין' });
    expect(await testExchangeConnectionAction({}, fd({ connectionId: CONNECTION }))).toEqual({ data: { notice: 'החיבור תקין' } });
    expect(testMyExchangeConnection).toHaveBeenCalledWith(CONNECTION);

    vi.mocked(testMyExchangeConnection).mockResolvedValueOnce({ ok: false, message: 'ההתחברות נדחתה' });
    expect(await testExchangeConnectionAction({}, fd({ connectionId: CONNECTION }))).toEqual({ serverError: 'ההתחברות נדחתה' });
  });

  it('answers a failure of each with its fixed line', async () => {
    vi.mocked(testMyExchangeConnection).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(listMyExchangeCalendars).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(revokeExchangeConnection).mockRejectedValueOnce(new Error('timeout'));

    expect(await testExchangeConnectionAction({}, fd({ connectionId: CONNECTION }))).toEqual({
      serverError: 'בדיקת החיבור נכשלה. נסו שוב.',
    });
    expect(await listExchangeCalendarsAction({}, fd({ connectionId: CONNECTION }))).toEqual({
      serverError: 'טעינת רשימת היומנים נכשלה. נסו שוב.',
    });
    expect(await revokeExchangeConnectionAction({}, fd({ connectionId: CONNECTION }))).toEqual({
      serverError: 'ניתוק החיבור נכשל. נסו שוב.',
    });
  });

  it('revokes the named connection and says so', async () => {
    vi.mocked(revokeExchangeConnection).mockResolvedValueOnce(undefined);

    expect(await revokeExchangeConnectionAction({}, fd({ connectionId: CONNECTION }))).toEqual({
      data: { notice: 'החיבור נותק.' },
    });
    expect(revokeExchangeConnection).toHaveBeenCalledWith(CONNECTION);
  });

  it('refuses a malformed connection id before the data layer, with its Hebrew message', async () => {
    const result = await testExchangeConnectionAction({}, fd({ connectionId: 'nope' }));

    expect(result.validationErrors?.fieldErrors?.connectionId).toEqual(['מזהה חיבור לא תקין']);
    expect(testMyExchangeConnection).not.toHaveBeenCalled();
  });
});

describe('the test appointment', () => {
  it('creating one hands back its id with the notice', async () => {
    vi.mocked(createMyExchangeTestAppointment).mockResolvedValueOnce({ ok: true, appointmentId: 'AAMkAG' });

    expect(await createExchangeTestAppointmentAction({}, fd({ connectionId: CONNECTION }))).toEqual({
      data: { notice: 'פגישת הבדיקה נוצרה. בדקו שהיא מופיעה ב-OWA, ואז מחקו אותה.', appointmentId: 'AAMkAG' },
    });
  });

  it('a malformed connection id is the one line the form shows', async () => {
    const result = await createExchangeTestAppointmentAction({}, fd({ connectionId: 'nope' }));

    expect(actionErrorMessage(result)).toBe('מזהה חיבור לא תקין');
    expect(createMyExchangeTestAppointment).not.toHaveBeenCalled();
  });

  it('deleting one with a malformed connection or appointment id is one line for both', async () => {
    const badConnection = await deleteExchangeTestAppointmentAction({}, fd({ connectionId: 'nope', appointmentId: 'AAMkAG' }));
    const noAppointment = await deleteExchangeTestAppointmentAction({}, fd({ connectionId: CONNECTION }));

    expect(actionErrorMessage(badConnection)).toBe('מזהה חיבור או פגישה לא תקין');
    expect(actionErrorMessage(noAppointment)).toBe('מזהה חיבור או פגישה לא תקין');
    expect(deleteMyExchangeTestAppointment).not.toHaveBeenCalled();
  });

  it('deleting one reports the data layer outcome', async () => {
    vi.mocked(deleteMyExchangeTestAppointment).mockResolvedValueOnce({ ok: true });
    expect(
      await deleteExchangeTestAppointmentAction({}, fd({ connectionId: CONNECTION, appointmentId: 'AAMkAG' })),
    ).toEqual({ data: { notice: 'פגישת הבדיקה נמחקה. ודאו שהיא נעלמה מ-OWA.' } });
    expect(deleteMyExchangeTestAppointment).toHaveBeenCalledWith(CONNECTION, 'AAMkAG');

    vi.mocked(deleteMyExchangeTestAppointment).mockResolvedValueOnce({ ok: false, message: 'הפגישה לא נמצאה' });
    expect(
      await deleteExchangeTestAppointmentAction({}, fd({ connectionId: CONNECTION, appointmentId: 'AAMkAG' })),
    ).toEqual({ serverError: 'הפגישה לא נמצאה' });
  });
});
