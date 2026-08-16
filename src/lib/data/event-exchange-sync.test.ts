import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/url', () => ({
  getAppUrl: vi.fn(async (path: string) => `https://beta.kalfa.me${path}`),
}));
vi.mock('@/lib/exchange-ews/crypto', () => ({ decryptCredential: vi.fn(() => 'pw') }));
vi.mock('@/lib/exchange-ews/calendar-provider', () => ({
  calendarProvider: {
    getAppointment: vi.fn(),
    updateAppointment: vi.fn(),
    createAppointment: vi.fn(),
    deleteAppointment: vi.fn(),
  },
}));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import { calendarProvider } from '@/lib/exchange-ews/calendar-provider';
import type { ExchangeAppointmentDetail } from '@/lib/exchange-ews/types';
import {
  EVENT_EXCHANGE_CANCELLED_CATEGORY,
  EVENT_EXCHANGE_CATEGORY,
} from '@/lib/data/event-exchange-calendar-item';
import { markEventExchangeCancelled, syncEventToExchange } from '@/lib/data/event-exchange-sync';

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

const CONNECTION: Row = {
  id: 'conn-1',
  user_id: 'user-1',
  mailbox_email: 'office@kalfa.me',
  auth_method: 'ntlm',
  status: 'verified',
  credential_ciphertext: 'x',
  credential_iv: 'y',
  credential_auth_tag: 'z',
  encryption_key_version: 1,
};

const EVENT_ROW: Row = {
  id: 'event-1',
  name: 'האירוע שלנו',
  event_type: 'wedding',
  event_date: '2026-09-01T18:00:00.000Z',
  rsvp_deadline: null,
  celebrants: { groom: 'יוסי', bride: 'דנה' },
  notes: null,
};

// Every awaited chain resolves in call order; each test declares the exact
// sequence its code path performs, so an added/reordered query fails loudly.
function mockAdmin(...results: Array<{ data: unknown; error: unknown }>) {
  const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
  const then = vi.spyOn(builder, 'then');
  for (const result of results) {
    then.mockImplementationOnce((f) => (f as (v: unknown) => unknown)(result));
  }
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as Admin);
  return builder as MockQueryBuilder<Row>;
}

beforeEach(() => vi.clearAllMocks());

describe('syncEventToExchange', () => {
  it('creates the appointment and writes the correlation row on a fresh publish', async () => {
    mockAdmin(
      { data: null, error: null }, // exchange_calendar_links lookup — not yet synced
      { data: EVENT_ROW, error: null }, // events read
      { data: [CONNECTION], error: null }, // exchange_connections lookup
      { data: null, error: null }, // exchange_calendar_links insert
    );
    vi.mocked(calendarProvider.createAppointment).mockResolvedValue({
      ok: true,
      data: { appointmentId: 'appt-1' },
    });

    await syncEventToExchange('event-1');

    expect(calendarProvider.createAppointment).toHaveBeenCalledTimes(1);
    const [, draft] = vi.mocked(calendarProvider.createAppointment).mock.calls[0];
    expect(draft.category).toBe(EVENT_EXCHANGE_CATEGORY);
    expect(draft.allDay).toBeUndefined();

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        action: 'exchange.event_synced',
        meta: expect.objectContaining({ connectionId: 'conn-1', hasRsvpDeadlineItem: false }),
      }),
    );
  });

  it('also creates a separate all-day item when rsvp_deadline is set', async () => {
    mockAdmin(
      { data: null, error: null },
      { data: { ...EVENT_ROW, rsvp_deadline: '2026-08-20' }, error: null },
      { data: [CONNECTION], error: null },
      { data: null, error: null },
    );
    vi.mocked(calendarProvider.createAppointment)
      .mockResolvedValueOnce({ ok: true, data: { appointmentId: 'appt-1' } })
      .mockResolvedValueOnce({ ok: true, data: { appointmentId: 'appt-2' } });

    await syncEventToExchange('event-1');

    expect(calendarProvider.createAppointment).toHaveBeenCalledTimes(2);
    const [, rsvpDraft] = vi.mocked(calendarProvider.createAppointment).mock.calls[1];
    expect(rsvpDraft.allDay).toBe(true);
    expect(rsvpDraft.showAs).toBe('free');

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ hasRsvpDeadlineItem: true }),
      }),
    );
  });

  it('no-ops when the event was already synced (idempotent)', async () => {
    mockAdmin({ data: { id: 'link-1' }, error: null });

    await syncEventToExchange('event-1');

    expect(calendarProvider.createAppointment).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('no-ops when there is no verified Exchange connection', async () => {
    mockAdmin(
      { data: null, error: null },
      { data: EVENT_ROW, error: null },
      { data: [], error: null }, // no verified connection
    );

    await syncEventToExchange('event-1');

    expect(calendarProvider.createAppointment).not.toHaveBeenCalled();
  });

  it('refuses to guess between two verified connections', async () => {
    mockAdmin(
      { data: null, error: null },
      { data: EVENT_ROW, error: null },
      { data: [CONNECTION, { ...CONNECTION, id: 'conn-2' }], error: null },
    );

    await syncEventToExchange('event-1');

    expect(calendarProvider.createAppointment).not.toHaveBeenCalled();
  });

  it('skips without throwing when the event has no event_date', async () => {
    mockAdmin(
      { data: null, error: null },
      { data: { ...EVENT_ROW, event_date: null }, error: null },
    );

    await expect(syncEventToExchange('event-1')).resolves.toBeUndefined();
    expect(calendarProvider.createAppointment).not.toHaveBeenCalled();
  });

  it('cleans up the appointment and never throws when the correlation insert loses a race', async () => {
    mockAdmin(
      { data: null, error: null },
      { data: EVENT_ROW, error: null },
      { data: [CONNECTION], error: null },
      { data: null, error: { message: 'duplicate key', code: '23505' } },
    );
    vi.mocked(calendarProvider.createAppointment).mockResolvedValue({
      ok: true,
      data: { appointmentId: 'appt-1' },
    });
    vi.mocked(calendarProvider.deleteAppointment).mockResolvedValue({ ok: true, data: undefined });

    await expect(syncEventToExchange('event-1')).resolves.toBeUndefined();

    expect(calendarProvider.deleteAppointment).toHaveBeenCalledWith(expect.anything(), 'appt-1');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('never throws when the DB read fails unexpectedly', async () => {
    mockAdmin({ data: null, error: { message: 'boom' } });

    await expect(syncEventToExchange('event-1')).resolves.toBeUndefined();
    expect(calendarProvider.createAppointment).not.toHaveBeenCalled();
  });
});

function appointmentDetail(overrides: Partial<ExchangeAppointmentDetail> = {}): ExchangeAppointmentDetail {
  return {
    id: 'appt-1',
    subject: 'החתונה של דנה ויוסי',
    start: new Date('2026-09-01T18:00:00.000Z'),
    end: new Date('2026-09-01T22:00:00.000Z'),
    allDay: false,
    showAs: 'busy',
    seriesLinked: false,
    location: '',
    body: '',
    reminderMinutes: 24 * 60,
    sensitivity: 'normal',
    category: EVENT_EXCHANGE_CATEGORY,
    attendees: [],
    recurrenceText: null,
    ...overrides,
  };
}

describe('markEventExchangeCancelled', () => {
  it('prefixes the subject and swaps the category, preserving start/end', async () => {
    mockAdmin(
      { data: { appointment_id: 'appt-1', rsvp_deadline_appointment_id: null }, error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointmentDetail() });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await markEventExchangeCancelled('event-1');

    expect(calendarProvider.updateAppointment).toHaveBeenCalledTimes(1);
    const [, appointmentId, update] = vi.mocked(calendarProvider.updateAppointment).mock.calls[0];
    expect(appointmentId).toBe('appt-1');
    expect(update.subject).toBe('[בוטל] החתונה של דנה ויוסי');
    expect(update.category).toBe(EVENT_EXCHANGE_CANCELLED_CATEGORY);
    expect(update.start).toEqual(new Date('2026-09-01T18:00:00.000Z'));
    expect(update.end).toEqual(new Date('2026-09-01T22:00:00.000Z'));

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1', action: 'exchange.event_cancelled_marked' }),
    );
  });

  it('marks both the main and the rsvp-deadline appointment when both exist', async () => {
    mockAdmin(
      { data: { appointment_id: 'appt-1', rsvp_deadline_appointment_id: 'appt-2' }, error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointmentDetail() });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await markEventExchangeCancelled('event-1');

    expect(calendarProvider.updateAppointment).toHaveBeenCalledTimes(2);
  });

  it('is idempotent — does not double-prefix an already-cancelled subject', async () => {
    mockAdmin(
      { data: { appointment_id: 'appt-1', rsvp_deadline_appointment_id: null }, error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({
      ok: true,
      data: appointmentDetail({ subject: '[בוטל] החתונה של דנה ויוסי' }),
    });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await markEventExchangeCancelled('event-1');

    const [, , update] = vi.mocked(calendarProvider.updateAppointment).mock.calls[0];
    expect(update.subject).toBe('[בוטל] החתונה של דנה ויוסי');
  });

  it('no-ops when the event was never synced', async () => {
    mockAdmin({ data: null, error: null });

    await markEventExchangeCancelled('event-1');

    expect(calendarProvider.getAppointment).not.toHaveBeenCalled();
    expect(calendarProvider.updateAppointment).not.toHaveBeenCalled();
  });

  it('skips an appointment the owner already deleted, without throwing', async () => {
    mockAdmin(
      { data: { appointment_id: 'appt-1', rsvp_deadline_appointment_id: null }, error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: false, error: 'not_found' });

    await expect(markEventExchangeCancelled('event-1')).resolves.toBeUndefined();
    expect(calendarProvider.updateAppointment).not.toHaveBeenCalled();
  });

  it('never throws when there is no reachable connection', async () => {
    mockAdmin(
      { data: { appointment_id: 'appt-1', rsvp_deadline_appointment_id: null }, error: null },
      { data: [], error: null },
    );

    await expect(markEventExchangeCancelled('event-1')).resolves.toBeUndefined();
    expect(calendarProvider.getAppointment).not.toHaveBeenCalled();
  });
});
