import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { markMock, unmarkMock, purgeMock, revalidateMock } = vi.hoisted(() => ({
  markMock: vi.fn(),
  unmarkMock: vi.fn(),
  purgeMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('@/lib/data/admin/test-events', () => ({
  markEventAsTest: markMock,
  unmarkEventAsTest: unmarkMock,
  purgeTestEvent: purgeMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; modelled so the purge's success path is observable.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  }),
}));

import { redirect } from 'next/navigation';

import { markTestEventAction, purgeTestEventAction, unmarkTestEventAction } from './actions';

// The test-event section of the staff event page: the data layer checks the permission (requirePlatformPermission per
// key) and then the id, so the action hands it the id as it was sent and answers each outcome with its own sentence.

const EVENT = '44444444-4444-4444-8444-444444444444';
const ACCESS_DENIED = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/access-denied;307;' });

function form(eventId?: string) {
  const fd = new FormData();
  if (eventId !== undefined) fd.set('eventId', eventId);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markTestEventAction', () => {
  it('marks the event, refreshes its page and says so', async () => {
    markMock.mockResolvedValue('marked');
    expect(await markTestEventAction({}, form(EVENT))).toEqual({ data: { notice: 'האירוע סומן כאירוע בדיקה.' } });
    expect(markMock).toHaveBeenCalledWith(EVENT);
    expect(revalidateMock).toHaveBeenCalledWith(`/admin/events/${EVENT}`);
  });

  it('an event that was already marked is not an error', async () => {
    markMock.mockResolvedValue('already_marked');
    expect(await markTestEventAction({}, form(EVENT))).toEqual({ data: { notice: 'האירוע סומן כאירוע בדיקה.' } });
  });

  it.each([
    ['not_staff', 'אין הרשאה לפעולה.'],
    ['no_event', 'האירוע לא נמצא.'],
  ])('answers %s with its own sentence and refreshes nothing', async (outcome, message) => {
    markMock.mockResolvedValue(outcome);
    expect(await markTestEventAction({}, form(EVENT))).toEqual({ serverError: message });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('hands the data layer the id as it was sent, an absent one as empty', async () => {
    markMock.mockResolvedValue('marked');
    await markTestEventAction({}, form('not-an-id'));
    expect(markMock).toHaveBeenLastCalledWith('not-an-id');
    await markTestEventAction({}, form());
    expect(markMock).toHaveBeenLastCalledWith('');
  });

  it('a failed write — the data layer’s own refusal of the id included — gets the fixed sentence', async () => {
    markMock.mockRejectedValue(new Error('מזהה אירוע אינו תקין'));
    expect(await markTestEventAction({}, form('not-an-id'))).toEqual({ serverError: 'סימון האירוע נכשל. נסו שוב.' });
  });

  it('lets the permission gate’s redirect through', async () => {
    markMock.mockRejectedValue(ACCESS_DENIED);
    await expect(markTestEventAction({}, form(EVENT))).rejects.toMatchObject({
      digest: expect.stringContaining('/access-denied'),
    });
  });
});

describe('unmarkTestEventAction', () => {
  it('removes the mark and says so', async () => {
    unmarkMock.mockResolvedValue('unmarked');
    expect(await unmarkTestEventAction({}, form(EVENT))).toEqual({ data: { notice: 'הסימון בוטל.' } });
    expect(revalidateMock).toHaveBeenCalledWith(`/admin/events/${EVENT}`);
  });

  it.each([
    ['not_staff', 'אין הרשאה לפעולה.'],
    ['no_event', 'האירוע לא נמצא.'],
  ])('answers %s with its own sentence', async (outcome, message) => {
    unmarkMock.mockResolvedValue(outcome);
    expect(await unmarkTestEventAction({}, form(EVENT))).toEqual({ serverError: message });
  });

  it('a failed write gets the fixed sentence', async () => {
    unmarkMock.mockRejectedValue(new Error('ביטול סימון אירוע הבדיקה נכשל'));
    expect(await unmarkTestEventAction({}, form(EVENT))).toEqual({ serverError: 'ביטול הסימון נכשל. נסו שוב.' });
  });
});

describe('purgeTestEventAction', () => {
  it('purges and goes to the campaign board — the event page would 404', async () => {
    purgeMock.mockResolvedValue('purged');
    await expect(purgeTestEventAction({}, form(EVENT))).rejects.toThrow('NEXT_REDIRECT');
    expect(purgeMock).toHaveBeenCalledWith(EVENT);
    expect(revalidateMock).toHaveBeenCalledWith('/admin/campaigns');
    expect(redirect).toHaveBeenCalledWith('/admin/campaigns');
  });

  it.each([
    ['not_marked', 'האירוע לא מסומן כאירוע בדיקה.'],
    [
      'financial_activity',
      'לא ניתן למחוק: באירוע יש פעילות כספית (תשלום או החזר ביומן התשלומים, מסמך SUMIT או גביית ביטול).',
    ],
    ['approved_terms', 'לא ניתן למחוק: בקמפיין של האירוע אושרו תנאים — מחיר מאושר הוא היסטוריה שאינה נמחקת.'],
    ['not_staff', 'אין הרשאה לפעולה.'],
    ['no_event', 'האירוע לא נמצא.'],
  ])('refuses %s with its own sentence and goes nowhere', async (outcome, message) => {
    purgeMock.mockResolvedValue(outcome);
    expect(await purgeTestEventAction({}, form(EVENT))).toEqual({ serverError: message });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('a failed purge gets the fixed sentence', async () => {
    purgeMock.mockRejectedValue(new Error('מחיקת אירוע הבדיקה נכשלה'));
    expect(await purgeTestEventAction({}, form(EVENT))).toEqual({ serverError: 'מחיקת האירוע נכשלה. נסו שוב.' });
  });
});
