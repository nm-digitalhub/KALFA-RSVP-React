import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/admin/callbacks', () => ({
  cancelCallback: vi.fn(),
  rescheduleCallback: vi.fn(),
  updateCallOutcome: vi.fn(),
}));

import { revalidatePath } from 'next/cache';

import { rescheduleCallback } from '@/lib/data/admin/callbacks';
import { rescheduleCallbackAction } from './actions';

const ID = '3b0ab9ec-c77b-4c75-b6e4-2c431c1d8cd0';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

// The action is where the form's Israel wall time becomes an instant. The data
// layer below it takes an instant and stores it as-is, so what this passes on is
// exactly what ends up in callback_requests.requested_at.
describe('rescheduleCallbackAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 06:33 in Israel (IDT, UTC+3) — the minute of the incident on 2026-10-07.
    vi.setSystemTime(new Date('2026-10-07T03:33:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('hands the data layer the real instant of the Israel time typed, not the raw string', async () => {
    vi.mocked(rescheduleCallback).mockResolvedValue({ ok: true });

    const result = await rescheduleCallbackAction(null, fd({ id: ID, exactAt: '2026-10-07T06:36' }));

    // Typed 06:36 in Israel = 03:36Z. Stored as the raw string it was read as
    // 06:36Z — three hours late.
    expect(rescheduleCallback).toHaveBeenCalledWith(ID, '2026-10-07T03:36:00.000Z');
    expect(result?.notice).toBe('השיחה תוזמנה מחדש');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/callbacks');
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/callbacks/${ID}`);
  });

  it('refuses a past time and never reaches the data layer', async () => {
    const result = await rescheduleCallbackAction(null, fd({ id: ID, exactAt: '2026-10-07T06:30' }));

    expect(result?.fieldErrors?.exactAt).toEqual(['נא לבחור מועד עתידי תקין']);
    expect(rescheduleCallback).not.toHaveBeenCalled();
  });

  it('refuses a value that already carries a zone instead of converting it twice', async () => {
    const result = await rescheduleCallbackAction(null, fd({ id: ID, exactAt: '2026-10-07T06:36Z' }));

    expect(result?.fieldErrors?.exactAt).toBeDefined();
    expect(rescheduleCallback).not.toHaveBeenCalled();
  });

  it('refuses a missing time', async () => {
    const result = await rescheduleCallbackAction(null, fd({ id: ID }));

    expect(result?.fieldErrors?.exactAt).toBeDefined();
    expect(rescheduleCallback).not.toHaveBeenCalled();
  });

  it('tells the admin when the old appointment could not be removed', async () => {
    vi.mocked(rescheduleCallback).mockResolvedValue({ ok: false, reason: 'old_appointment_not_removed' });

    const result = await rescheduleCallbackAction(null, fd({ id: ID, exactAt: '2026-10-07T06:36' }));

    expect(result?.error).toBe('לא ניתן היה להסיר את הפגישה הקיימת מהיומן. נסו שוב עוד רגע.');
  });

  it('re-throws a Next redirect from the admin gate instead of swallowing it', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
    });
    vi.mocked(rescheduleCallback).mockRejectedValue(redirect);

    await expect(
      rescheduleCallbackAction(null, fd({ id: ID, exactAt: '2026-10-07T06:36' })),
    ).rejects.toThrow('NEXT_REDIRECT');
  });
});
