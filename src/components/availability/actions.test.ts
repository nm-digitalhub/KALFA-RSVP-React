import { beforeEach, describe, expect, it, vi } from 'vitest';

// The availability actions answer with the state re-read from the server, or with exactly one Hebrew message: the
// schema's for a malformed input, the domain layer's refusal, or the action's own fixed text for a failure — including
// the "saved, but the list did not refresh" message, which must not be replaced by the mutation's failure message.

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/exchange-availability', () => ({
  clearActiveAvailabilityBlocks: vi.fn(),
  createAvailabilityBlock: vi.fn(),
  deleteAvailabilityBlock: vi.fn(),
  getMyPresence: vi.fn(),
  listMyAvailabilityBlocks: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import {
  clearActiveAvailabilityBlocks,
  createAvailabilityBlock,
  deleteAvailabilityBlock,
  getMyPresence,
  listMyAvailabilityBlocks,
} from '@/lib/data/exchange-availability';
import {
  clearAvailabilityAction,
  refreshAvailabilityAction,
  removeAvailabilityBlockAction,
  setAvailabilityBlockAction,
} from './actions';

const PRESENCE = { showAs: 'free', untilIso: null, ownedByApp: false } as const;
const BLOCK_INPUT = {
  showAs: 'busy',
  startsAtIso: '2099-01-01T10:00:00.000Z',
  endsAtIso: '2099-01-01T11:00:00.000Z',
} as const;
const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMyAvailabilityBlocks).mockResolvedValue([]);
  vi.mocked(getMyPresence).mockResolvedValue(PRESENCE as never);
  vi.mocked(createAvailabilityBlock).mockResolvedValue({ ok: true });
  vi.mocked(clearActiveAvailabilityBlocks).mockResolvedValue({ ok: true });
  vi.mocked(deleteAvailabilityBlock).mockResolvedValue({ ok: true });
});

describe('refreshAvailabilityAction', () => {
  it('answers with the live state', async () => {
    expect(await refreshAvailabilityAction()).toEqual({ data: { blocks: [], presence: PRESENCE } });
  });

  it('a failed read is its fixed message', async () => {
    vi.mocked(getMyPresence).mockRejectedValue(new Error('Exchange down'));

    expect(await refreshAvailabilityAction()).toEqual({ serverError: 'רענון הסטטוס נכשל.' });
  });

  it('re-throws a Next.js control-flow signal', async () => {
    vi.mocked(listMyAvailabilityBlocks).mockRejectedValue(NEXT_REDIRECT);

    await expect(refreshAvailabilityAction()).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('setAvailabilityBlockAction', () => {
  it('writes the block, revalidates, and answers with the re-read state', async () => {
    const result = await setAvailabilityBlockAction(BLOCK_INPUT);

    expect(createAvailabilityBlock).toHaveBeenCalledWith(BLOCK_INPUT);
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout');
    expect(result).toEqual({ data: { blocks: [], presence: PRESENCE } });
  });

  it('a malformed status is the schema’s message, and nothing is written', async () => {
    // Deliberately outside the input type: what a tampered request could send. Cast only this value.
    const result = await setAvailabilityBlockAction({ ...BLOCK_INPUT, showAs: 'away' as never });

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { showAs: ['סטטוס לא תקין'] } } });
    expect(createAvailabilityBlock).not.toHaveBeenCalled();
  });

  it('a malformed time is the schema’s message', async () => {
    const result = await setAvailabilityBlockAction({ ...BLOCK_INPUT, startsAtIso: 'tomorrow' });

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { startsAtIso: ['תאריך לא תקין'] } } });
  });

  it('the domain layer’s refusal is passed as given', async () => {
    vi.mocked(createAvailabilityBlock).mockResolvedValue({ ok: false, message: 'אין חיבור ליומן.' });

    expect(await setAvailabilityBlockAction(BLOCK_INPUT)).toEqual({ serverError: 'אין חיבור ליומן.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a thrown write failure is the fixed message', async () => {
    vi.mocked(createAvailabilityBlock).mockRejectedValue(new Error('Graph 503'));

    expect(await setAvailabilityBlockAction(BLOCK_INPUT)).toEqual({ serverError: 'עדכון הסטטוס נכשל. נסו שוב.' });
  });

  it('saved but not re-read: the "updated, refresh failed" message, not the write failure', async () => {
    vi.mocked(listMyAvailabilityBlocks).mockRejectedValue(new Error('db down'));

    expect(await setAvailabilityBlockAction(BLOCK_INPUT)).toEqual({
      serverError: 'הסטטוס עודכן, אך רענון הרשימה נכשל.',
    });
  });
});

describe('clearAvailabilityAction', () => {
  it('clears and answers with the re-read state', async () => {
    expect(await clearAvailabilityAction()).toEqual({ data: { blocks: [], presence: PRESENCE } });
  });

  it('refusal, failure, and saved-but-not-re-read each keep their text', async () => {
    vi.mocked(clearActiveAvailabilityBlocks).mockResolvedValueOnce({ ok: false, message: 'אין חיבור ליומן.' });
    expect(await clearAvailabilityAction()).toEqual({ serverError: 'אין חיבור ליומן.' });

    vi.mocked(clearActiveAvailabilityBlocks).mockRejectedValueOnce(new Error('Graph 503'));
    expect(await clearAvailabilityAction()).toEqual({ serverError: 'ניקוי הסטטוס נכשל. נסו שוב.' });

    vi.mocked(getMyPresence).mockRejectedValueOnce(new Error('Exchange down'));
    expect(await clearAvailabilityAction()).toEqual({ serverError: 'הסטטוס נוקה, אך רענון הרשימה נכשל.' });
  });
});

describe('removeAvailabilityBlockAction', () => {
  const BLOCK = '11111111-1111-4111-8111-111111111111';

  it('removes the block and answers with the re-read state', async () => {
    const result = await removeAvailabilityBlockAction({ blockId: BLOCK });

    expect(deleteAvailabilityBlock).toHaveBeenCalledWith(BLOCK);
    expect(result).toEqual({ data: { blocks: [], presence: PRESENCE } });
  });

  it('a malformed id is the schema’s message, and nothing is removed', async () => {
    const result = await removeAvailabilityBlockAction({ blockId: 'x' });

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { blockId: ['מזהה סטטוס לא תקין'] } } });
    expect(deleteAvailabilityBlock).not.toHaveBeenCalled();
  });

  it('refusal, failure, and saved-but-not-re-read each keep their text', async () => {
    vi.mocked(deleteAvailabilityBlock).mockResolvedValueOnce({ ok: false, message: 'הסטטוס לא נמצא.' });
    expect(await removeAvailabilityBlockAction({ blockId: BLOCK })).toEqual({ serverError: 'הסטטוס לא נמצא.' });

    vi.mocked(deleteAvailabilityBlock).mockRejectedValueOnce(new Error('Graph 503'));
    expect(await removeAvailabilityBlockAction({ blockId: BLOCK })).toEqual({
      serverError: 'ביטול הסטטוס נכשל. נסו שוב.',
    });

    vi.mocked(listMyAvailabilityBlocks).mockRejectedValueOnce(new Error('db down'));
    expect(await removeAvailabilityBlockAction({ blockId: BLOCK })).toEqual({
      serverError: 'הסטטוס בוטל, אך רענון הרשימה נכשל.',
    });
  });
});
