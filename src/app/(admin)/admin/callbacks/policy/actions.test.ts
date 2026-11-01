import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
const eq = vi.fn();
const update = vi.fn((row: Record<string, unknown>) => {
  void row;
  return { eq };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ from: () => ({ update }) })) }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { actionFormError } from '@/lib/action-result';
import { saveCallbackPolicyAction } from './actions';

// The callback-policy form, read the way it always was: a day is open only when its checkbox sends 'on', a closed day
// renders no time inputs, a blank number reads as 0, and a refused hour or number is answered beside its field.

const NUMBERS = {
  minNoticeMinutes: '120',
  horizonDays: '14',
  durationMinutes: '15',
  dailyCap: '8',
  motzashResumeMinutes: '30',
  maxAttempts: '3',
  attemptWindowDays: '30',
};

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const savedRow = () => update.mock.calls[0]![0];

beforeEach(() => {
  vi.clearAllMocks();
  eq.mockResolvedValue({ error: null });
});

describe('saveCallbackPolicyAction', () => {
  it('saves with every day closed (no time inputs sent): all hours null', async () => {
    const result = await saveCallbackPolicyAction({}, form(NUMBERS));

    expect(result).toEqual({ data: { notice: 'מדיניות התזמון נשמרה' } });
    expect(savedRow()).toMatchObject({ sun_start_min: null, sat_end_min: null, dial_sun_start_min: null, horizon_days: 14 });
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('reads an open day’s HH:MM as minutes, in both tabs', async () => {
    await saveCallbackPolicyAction(
      {},
      form({ ...NUMBERS, sunOpen: 'on', sunStart: '09:00', sunEnd: '17:30', dialMonOpen: 'on', dialMonStart: '10:00', dialMonEnd: '11:00' }),
    );

    expect(savedRow()).toMatchObject({
      sun_start_min: 540,
      sun_end_min: 1050,
      mon_start_min: null,
      dial_mon_start_min: 600,
      dial_mon_end_min: 660,
    });
  });

  it.each([
    ['an end before its start', { tueOpen: 'on', tueStart: '18:00', tueEnd: '09:00' }, 'tueStart'],
    ['an open dial day with no hours', { dialFriOpen: 'on' }, 'dialFriStart'],
  ])('refuses %s on the start field with the Hebrew message, before the gate', async (_label, override, field) => {
    const result = await saveCallbackPolicyAction({}, form({ ...NUMBERS, ...override }));

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { [field]: ['שעת התחלה/סיום לא תקינה'] } } });
    // Answered beside the field only: nothing above the form.
    expect(actionFormError(result)).toBeUndefined();
    expect(requirePlatformPermission).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a blank number reads as 0, with the same message the old `|| "0"` path gave; a missing one saves as 0', async () => {
    const old = z.coerce.number().int().min(1).max(90).safeParse('0');

    const blank = await saveCallbackPolicyAction({}, form({ ...NUMBERS, horizonDays: '' }));
    expect(blank.validationErrors?.fieldErrors).toEqual({ horizonDays: [old.error!.issues[0]!.message] });

    const { minNoticeMinutes: _omitted, ...rest } = NUMBERS;
    void _omitted;
    expect(await saveCallbackPolicyAction({}, form(rest))).toEqual({ data: { notice: 'מדיניות התזמון נשמרה' } });
    expect(savedRow().min_notice_minutes).toBe(0);
  });

  it('a database refusal and a thrown failure answer the same fixed message', async () => {
    eq.mockResolvedValueOnce({ error: { message: 'violates check constraint' } });
    expect(await saveCallbackPolicyAction({}, form(NUMBERS))).toEqual({ serverError: 'עדכון מדיניות התזמון נכשל. נסו שוב.' });

    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(new Error('boom'));
    const thrown = await saveCallbackPolicyAction({}, form(NUMBERS));
    expect(thrown).toEqual({ serverError: 'עדכון מדיניות התזמון נכשל. נסו שוב.' });
    expect(actionFormError(thrown)).toBe('עדכון מדיניות התזמון נכשל. נסו שוב.');
  });
});
