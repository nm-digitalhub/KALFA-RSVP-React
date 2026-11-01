import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { listMock, categoriesMock, getMock, createMock, updateMock, deleteMock, logMock, sendMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  categoriesMock: vi.fn(),
  getMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  logMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@/lib/data/exchange-connections', () => ({
  listMyExchangeCalendarEvents: listMock,
  listMyExchangeCategories: categoriesMock,
  getMyExchangeCalendarEvent: getMock,
  createMyExchangeCalendarEvent: createMock,
  updateMyExchangeCalendarEvent: updateMock,
  deleteMyExchangeCalendarEvent: deleteMock,
}));
vi.mock('@/lib/data/activity', () => ({ logActivity: logMock }));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: async () => ({ send: sendMock }) }));

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  fetchCalendarCategoriesAction,
  fetchCalendarEventAction,
  fetchCalendarEventsAction,
  updateCalendarEventAction,
} from './actions';

// The admin Exchange calendar shows ONE sentence per failure: a fixed one when a read's input is rejected, the first
// problem the schema found when a write's is (a nested one included, such as an attendee's address), the data layer's
// own message when it refuses, and a fixed one when the call throws.

const CONNECTION = '55555555-5555-4555-8555-555555555555';
const START = '2026-11-01T10:00:00+02:00';
const END = '2026-11-01T11:00:00+02:00';

const refused = (message: string) => ({ validationErrors: { formErrors: [message], fieldErrors: {} } });

beforeEach(() => {
  vi.clearAllMocks();
  logMock.mockResolvedValue(undefined);
  sendMock.mockResolvedValue('job-1');
});

describe('the reads', () => {
  it('returns the events', async () => {
    listMock.mockResolvedValue({ ok: true, events: [{ id: 'a-1' }] });
    expect(await fetchCalendarEventsAction({ connectionId: CONNECTION, startIso: START, endIso: END })).toEqual({
      data: { events: [{ id: 'a-1' }] },
    });
    expect(listMock).toHaveBeenCalledWith(CONNECTION, { startIso: START, endIso: END });
  });

  it('answers a rejected range with its fixed sentence, without reaching the mailbox', async () => {
    expect(await fetchCalendarEventsAction({ connectionId: CONNECTION, startIso: 'yesterday', endIso: END })).toEqual(
      refused('טווח תאריכים לא תקין'),
    );
    expect(listMock).not.toHaveBeenCalled();
  });

  it('passes the data layer’s refusal through, and answers a throw with the fixed sentence', async () => {
    listMock.mockResolvedValue({ ok: false, message: 'החיבור ליומן אינו פעיל' });
    expect(await fetchCalendarEventsAction({ connectionId: CONNECTION, startIso: START, endIso: END })).toEqual({
      serverError: 'החיבור ליומן אינו פעיל',
    });
    listMock.mockRejectedValue(new Error('EWS timeout'));
    expect(await fetchCalendarEventsAction({ connectionId: CONNECTION, startIso: START, endIso: END })).toEqual({
      serverError: 'טעינת היומן נכשלה. נסו שוב.',
    });
  });

  it('categories: the list, a rejected connection, a throw', async () => {
    categoriesMock.mockResolvedValue({ ok: true, categories: [{ name: 'לקוחות', color: 1 }] });
    expect(await fetchCalendarCategoriesAction({ connectionId: CONNECTION })).toEqual({
      data: { categories: [{ name: 'לקוחות', color: 1 }] },
    });
    expect(await fetchCalendarCategoriesAction({ connectionId: 'nope' })).toEqual(refused('מזהה חיבור לא תקין'));
    categoriesMock.mockRejectedValue(new Error('EWS timeout'));
    expect(await fetchCalendarCategoriesAction({ connectionId: CONNECTION })).toEqual({
      serverError: 'טעינת הקטגוריות נכשלה.',
    });
  });

  it('one event: its detail, a rejected id, a throw', async () => {
    getMock.mockResolvedValue({ ok: true, event: { id: 'a-1', title: 'פגישה' } });
    expect(await fetchCalendarEventAction({ connectionId: CONNECTION, appointmentId: 'a-1' })).toEqual({
      data: { event: { id: 'a-1', title: 'פגישה' } },
    });
    expect(await fetchCalendarEventAction({ connectionId: CONNECTION, appointmentId: 'x'.repeat(1025) })).toEqual(
      refused('מזהה אירוע לא תקין'),
    );
    getMock.mockRejectedValue(new Error('EWS timeout'));
    expect(await fetchCalendarEventAction({ connectionId: CONNECTION, appointmentId: 'a-1' })).toEqual({
      serverError: 'טעינת פרטי האירוע נכשלה.',
    });
  });
});

describe('createCalendarEventAction', () => {
  const draft = { connectionId: CONNECTION, subject: 'פגישה', startIso: START, endIso: END, allDay: false };

  it('creates the event with what was given, and nothing else', async () => {
    createMock.mockResolvedValue({ ok: true });
    expect(await createCalendarEventAction({ ...draft, location: 'תל אביב', category: '' })).toEqual({});
    expect(createMock).toHaveBeenCalledWith(CONNECTION, {
      subject: 'פגישה',
      startIso: START,
      endIso: END,
      allDay: false,
      location: 'תל אביב',
    });
  });

  it('answers a rejected input with the first problem the schema found', async () => {
    expect(await createCalendarEventAction({ ...draft, subject: '  ' })).toEqual(refused('נא להזין כותרת לאירוע'));
    // Nested under attendees[0] — the one sentence still names it.
    expect(await createCalendarEventAction({ ...draft, attendees: [{ email: 'not-an-address' }] })).toEqual(
      refused('כתובת אימייל לא תקינה'),
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses an end that is not after the start, without reaching the mailbox', async () => {
    expect(await createCalendarEventAction({ ...draft, endIso: START })).toEqual({
      serverError: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('passes the data layer’s refusal through, and answers a throw with the fixed sentence', async () => {
    createMock.mockResolvedValue({ ok: false, message: 'Exchange סירב ליצור את האירוע' });
    expect(await createCalendarEventAction(draft)).toEqual({ serverError: 'Exchange סירב ליצור את האירוע' });
    createMock.mockRejectedValue(new Error('EWS timeout'));
    expect(await createCalendarEventAction(draft)).toEqual({ serverError: 'יצירת האירוע נכשלה. נסו שוב.' });
  });
});

describe('updateCalendarEventAction', () => {
  const move = { connectionId: CONNECTION, appointmentId: 'a-1', startIso: START, endIso: END };

  it('moves the event, records who did, and wakes the callback sweep', async () => {
    updateMock.mockResolvedValue({ ok: true });
    expect(await updateCalendarEventAction(move)).toEqual({});
    expect(updateMock).toHaveBeenCalledWith(CONNECTION, { appointmentId: 'a-1', startIso: START, endIso: END });
    expect(logMock).toHaveBeenCalledWith({
      action: 'calendar.event_updated',
      meta: { appointment_id: 'a-1', start_iso: START },
    });
    expect(sendMock).toHaveBeenCalledWith('callback-calendar-schedule-sweep', {});
  });

  it('a failed audit or nudge never fails the move the admin already made', async () => {
    updateMock.mockResolvedValue({ ok: true });
    logMock.mockRejectedValue(new Error('db down'));
    sendMock.mockRejectedValue(new Error('queue down'));
    expect(await updateCalendarEventAction(move)).toEqual({});
  });

  it('records nothing when the move was refused or failed', async () => {
    updateMock.mockResolvedValue({ ok: false, message: 'האירוע לא נמצא ביומן' });
    expect(await updateCalendarEventAction(move)).toEqual({ serverError: 'האירוע לא נמצא ביומן' });
    updateMock.mockRejectedValue(new Error('EWS timeout'));
    expect(await updateCalendarEventAction(move)).toEqual({ serverError: 'עדכון האירוע נכשל. נסו שוב.' });
    expect(logMock).not.toHaveBeenCalled();
  });

  it('answers a rejected input with the first problem the schema found', async () => {
    expect(await updateCalendarEventAction({ ...move, reminderMinutes: 20000 })).toEqual(
      refused('זמן התזכורת ארוך מדי'),
    );
    expect(await updateCalendarEventAction({ ...move, endIso: START })).toEqual({
      serverError: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('deleteCalendarEventAction', () => {
  it('deletes the event and records it', async () => {
    deleteMock.mockResolvedValue({ ok: true });
    expect(await deleteCalendarEventAction({ connectionId: CONNECTION, appointmentId: 'a-1' })).toEqual({});
    expect(deleteMock).toHaveBeenCalledWith(CONNECTION, 'a-1');
    expect(logMock).toHaveBeenCalledWith({ action: 'calendar.event_deleted', meta: { appointment_id: 'a-1' } });
  });

  it('a rejected connection, a refusal, a throw', async () => {
    expect(await deleteCalendarEventAction({ connectionId: 'nope', appointmentId: 'a-1' })).toEqual(
      refused('מזהה חיבור לא תקין'),
    );
    deleteMock.mockResolvedValue({ ok: false, message: 'האירוע לא נמצא ביומן' });
    expect(await deleteCalendarEventAction({ connectionId: CONNECTION, appointmentId: 'a-1' })).toEqual({
      serverError: 'האירוע לא נמצא ביומן',
    });
    deleteMock.mockRejectedValue(new Error('EWS timeout'));
    expect(await deleteCalendarEventAction({ connectionId: CONNECTION, appointmentId: 'a-1' })).toEqual({
      serverError: 'מחיקת האירוע נכשלה. נסו שוב.',
    });
  });
});
