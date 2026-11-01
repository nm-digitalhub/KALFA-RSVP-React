import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn(() => {
      throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/access-denied;307;' });
    }),
  };
});
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/vox-log-export', () => ({ runLogExport: vi.fn() }));
vi.mock('@/lib/data/elevenlabs-status', () => ({ setElevenLabsApiKey: vi.fn() }));
vi.mock('@/lib/data/admin/voximplant-channel', () => ({
  wireVoximplantAccountCallback: vi.fn(),
  rollbackVoximplantAccountCallback: vi.fn(),
}));

import { redirect } from 'next/navigation';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { runLogExport } from '@/lib/data/vox-log-export';
import { setElevenLabsApiKey } from '@/lib/data/elevenlabs-status';
import {
  rollbackVoximplantAccountCallback,
  wireVoximplantAccountCallback,
} from '@/lib/data/admin/voximplant-channel';
import {
  refreshVoicePlatformAction,
  rollbackAccountCallbackAction,
  runLogExportAction,
  saveElevenLabsKeyAction,
  wireAccountCallbackAction,
} from './actions';

// The voice platform actions: every one gates on manage_voice, the integration ones answer a failure with one fixed
// message (a provider's text is never returned or logged), and a refusal keeps the data layer's own Hebrew message.

function keyForm(value?: string): FormData {
  const fd = new FormData();
  if (value !== undefined) fd.set('elevenlabs_api_key', value);
  return fd;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('refresh and log export', () => {
  it('answer with their notices', async () => {
    expect(await refreshVoicePlatformAction({})).toEqual({ data: { notice: 'רועננו הנתונים' } });

    vi.mocked(runLogExport).mockResolvedValue({ stored: 2, noLog: 1, failed: 0, purged: 3 } as never);
    expect(await runLogExportAction({})).toEqual({ data: { notice: 'ייצוא לוגים: 2 נשמרו, 1 ללא לוג, 0 נכשלו, 3 נוקו' } });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
  });

  it('a failed export run is the fixed message', async () => {
    vi.mocked(runLogExport).mockRejectedValue(new Error('x'));
    expect(await runLogExportAction({})).toEqual({ serverError: 'הרצת ייצוא הלוגים נכשלה. נסו שוב.' });
  });
});

describe('wireAccountCallbackAction', () => {
  it('a refusal keeps the data layer’s own message, and nothing is logged', async () => {
    vi.mocked(wireVoximplantAccountCallback).mockResolvedValue({
      ok: false,
      message: 'הערוץ אינו מוגדר — נדרש חשבון שירות תקין תחילה',
    });

    expect(await wireAccountCallbackAction()).toEqual({ serverError: 'הערוץ אינו מוגדר — נדרש חשבון שירות תקין תחילה' });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('success returns the notice and the registered URL, once', async () => {
    vi.mocked(wireVoximplantAccountCallback).mockResolvedValue({
      ok: true,
      callbackUrl: 'https://kalfa.me/api/voximplant/account-callback/t',
      rawToken: 't',
      echoConfirmed: false,
    });

    expect(await wireAccountCallbackAction()).toEqual({
      data: {
        notice: 'החיווט נרשם. האימות מול echo לא הושלם — יאושר עם ה־callback הראשון.',
        callbackUrl: 'https://kalfa.me/api/voximplant/account-callback/t',
      },
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it('a thrown failure is the fixed message and is not logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(wireVoximplantAccountCallback).mockRejectedValue(new Error('provider said token=abc'));

    expect(await wireAccountCallbackAction()).toEqual({ serverError: 'החיווט נכשל. נסו שוב.' });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('rollbackAccountCallbackAction', () => {
  it('a refusal and a success both carry the data layer’s message; a throw is the fixed one', async () => {
    vi.mocked(rollbackVoximplantAccountCallback).mockResolvedValue({ ok: false, message: 'הערוץ אינו מוגדר' });
    expect(await rollbackAccountCallbackAction()).toEqual({ serverError: 'הערוץ אינו מוגדר' });

    vi.mocked(rollbackVoximplantAccountCallback).mockResolvedValue({ ok: true, message: 'החיווט בוטל' });
    expect(await rollbackAccountCallbackAction()).toEqual({ data: { notice: 'החיווט בוטל' } });

    vi.mocked(rollbackVoximplantAccountCallback).mockRejectedValue(new Error('x'));
    expect(await rollbackAccountCallbackAction()).toEqual({ serverError: 'ביטול החיווט נכשל. נסו שוב.' });
  });
});

describe('saveElevenLabsKeyAction', () => {
  it('a blank or missing key clears; a key is saved as typed', async () => {
    expect(await saveElevenLabsKeyAction({}, keyForm(''))).toEqual({ data: { notice: 'המפתח נוקה.' } });
    expect(await saveElevenLabsKeyAction({}, keyForm())).toEqual({ data: { notice: 'המפתח נוקה.' } });
    expect(setElevenLabsApiKey).toHaveBeenNthCalledWith(2, '');

    expect(await saveElevenLabsKeyAction({}, keyForm('xi-123'))).toEqual({ data: { notice: 'מפתח ElevenLabs נשמר.' } });
    expect(setElevenLabsApiKey).toHaveBeenLastCalledWith('xi-123');
  });

  it('gates BEFORE the form is read, as it always did', async () => {
    vi.mocked(requirePlatformPermission).mockImplementationOnce(async () => redirect('/access-denied'));
    // A malformed submission (the field twice) would fail the schema; the gate answers first.
    const twice = keyForm('a');
    twice.append('elevenlabs_api_key', 'b');

    await expect(saveElevenLabsKeyAction({}, twice)).rejects.toThrow('NEXT_REDIRECT');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
    expect(setElevenLabsApiKey).not.toHaveBeenCalled();
  });

  it('a failure is the fixed message; the key is neither returned nor logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(setElevenLabsApiKey).mockRejectedValue(new Error('xi-123 rejected'));

    const result = await saveElevenLabsKeyAction({}, keyForm('xi-123'));

    expect(result).toEqual({ serverError: 'שמירת המפתח נכשלה. נסו שוב.' });
    expect(JSON.stringify(result)).not.toContain('xi-123');
    expect(log).not.toHaveBeenCalled();
  });
});
