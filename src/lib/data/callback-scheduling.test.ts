import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.kalfa.me') }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: vi.fn() }));
vi.mock('@/lib/exchange-ews/calendar-provider', () => ({
  calendarProvider: {
    getAvailability: vi.fn(),
    getAppointment: vi.fn(),
    updateAppointment: vi.fn(),
    createAppointment: vi.fn(),
    deleteAppointment: vi.fn(),
    listAppointments: vi.fn(),
  },
}));
// Kept REAL by default — the repair tests assert against the true rendering, so
// a drift between what a repair writes and what a create writes would fail
// here. Only the guard test overrides it, to reproduce the one failure mode we
// measured but cannot reproduce from the code.
vi.mock('@/lib/callbacks/calendar-item', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/callbacks/calendar-item')>();
  return { ...actual, buildCallbackDraft: vi.fn(actual.buildCallbackDraft) };
});

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { calendarProvider } from '@/lib/exchange-ews/calendar-provider';
import { buildCallbackDraft } from '@/lib/callbacks/calendar-item';
import { getSmsSender } from '@/lib/sms/sender';
import type { ExchangeAppointment, ExchangeAppointmentDetail } from '@/lib/exchange-ews/types';
import {
  applyCallOutcome,
  closeCallbackAppointment,
  countOrphanedCalendarAppointments,
  countStrandedCallbacks,
  reconcileCallbacksWithCalendar,
  repairBlankCallbackBodies,
  rescheduleCallbackRequest,
  scheduleCallbackAppointment,
  type SchedulableCallback,
} from '@/lib/data/callback-scheduling';
import { salesCallDispatchJobId } from '@/lib/data/sales-call-dispatch';
import { meetingConfirmDispatchJobId } from '@/lib/data/meeting-confirm-dispatch';

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

// Tuesday 09:00 Israel — inside business hours, so the slot search succeeds and
// the assertions are about the body, not about scheduling.
const NOW_MS = Date.parse('2026-07-28T06:00:00Z');

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

const REQUEST: SchedulableCallback = {
  id: 'req-1',
  full_name: 'ישראל ישראלי',
  phone: '+972532743588',
  topic: 'מכירות',
  note: 'אשמח לשמוע פרטים',
  requested_at: null,
  created_at: '2026-07-28T04:57:53Z',
  attempt_count: 0,
  calendar_item_id: 'item-1',
};

const START = new Date('2026-07-28T07:40:00Z');
const END = new Date('2026-07-28T07:55:00Z');

function appointment(body: string): ExchangeAppointmentDetail {
  return {
    id: 'item-1',
    subject: 'שיחה חוזרת — ישראל ישראלי',
    start: START,
    end: END,
    allDay: false,
    showAs: 'busy',
    seriesLinked: false,
    location: '',
    body,
    reminderMinutes: 10,
    sensitivity: 'private',
    category: 'KALFA — שיחת לקוח',
    attendees: [],
    recurrenceText: null,
  };
}

// Each awaited chain resolves in call order; every test declares the exact
// sequence its code path performs, so an added query fails loudly here.
// `count` is optional because only counted queries ({ count: 'exact', head: true })
// resolve with one — countStrandedCallbacks is the first such caller here.
function mockAdmin(
  ...results: Array<{ data: unknown; error: unknown; count?: number | null }>
) {
  const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
  const then = vi.spyOn(builder, 'then');
  for (const result of results) {
    then.mockImplementationOnce((f) => (f as (v: unknown) => unknown)(result));
  }
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as Admin);
  return builder as MockQueryBuilder<Row>;
}

beforeEach(() => vi.clearAllMocks());

// The description is the only part of the item that carries the number to dial.
// An appointment that reaches the mailbox without one is indistinguishable from
// a scheduled call until someone opens it with the phone already in their hand.
describe('scheduleCallbackAppointment — empty-body guard', () => {
  it('refuses to create an appointment whose description came out blank', async () => {
    mockAdmin(
      { data: [CONNECTION], error: null }, // loadBusinessConnection
      { data: [], error: null }, // countScheduledPerDay
    );
    vi.mocked(calendarProvider.getAvailability).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(buildCallbackDraft).mockReturnValueOnce({
      subject: 'שיחה חוזרת — ישראל ישראלי',
      start: START,
      end: END,
      body: '   ',
      bodyIsHtml: true,
    });

    const outcome = await scheduleCallbackAppointment(
      { ...REQUEST, calendar_item_id: null },
      { nowMs: NOW_MS },
    );

    expect(outcome).toEqual({ ok: false, reason: 'empty_body' });
    // The row keeps no link, so the next tick retries rather than stranding it.
    expect(calendarProvider.createAppointment).not.toHaveBeenCalled();
  });
});

// Regression for the exact bug the user found live (2026-08-19): a request
// the scheduler had successfully booked still showed 'חדש' (new) in the admin
// list, because the success path never wrote `status` at all. This asserts
// the write the whole redesign exists to make happen.
describe('scheduleCallbackAppointment — success path', () => {
  it('books the slot and marks the row scheduled', async () => {
    const builder = mockAdmin(
      { data: [CONNECTION], error: null }, // loadBusinessConnection
      { data: [], error: null }, // countScheduledPerDay
      { data: null, error: null }, // the link-write update
    );
    vi.mocked(calendarProvider.getAvailability).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(calendarProvider.createAppointment).mockResolvedValue({
      ok: true,
      data: { appointmentId: 'item-new' },
    });

    const outcome = await scheduleCallbackAppointment(
      { ...REQUEST, calendar_item_id: null },
      { nowMs: NOW_MS },
    );

    expect(outcome.ok).toBe(true);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        calendar_item_id: 'item-new',
        status: 'scheduled',
        scheduling_failure_reason: null,
      }),
    );
  });
});

describe('repairBlankCallbackBodies', () => {
  it('fills in a blank description with exactly what a fresh create would write', async () => {
    mockAdmin(
      { data: [REQUEST], error: null }, // candidate rows
      { data: [CONNECTION], error: null }, // loadBusinessConnection
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 1 });
    const [, itemId, update] = vi.mocked(calendarProvider.updateAppointment).mock.calls[0];
    expect(itemId).toBe('item-1');
    expect(update.bodyIsHtml).toBe(true);
    expect(update.body).toContain('href="tel:+972532743588"');
    expect(update.body).toContain('פתיחת הפנייה');
    // A repair writes the description and nothing else — the slot the owner has
    // already seen must not move under them.
    expect(update.start).toEqual(START);
    expect(update.end).toEqual(END);
    expect(update.subject).toBeUndefined();
  });

  it('never overwrites a description the owner typed in Outlook', async () => {
    mockAdmin(
      { data: [REQUEST], error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({
      ok: true,
      data: appointment('להתקשר אחרי 14:00'),
    });

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 0 });
    expect(calendarProvider.updateAppointment).not.toHaveBeenCalled();
  });

  it('leaves an unreadable appointment to the reconcile pass', async () => {
    mockAdmin(
      { data: [REQUEST], error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: false, error: 'not_found' });

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 0 });
    expect(calendarProvider.updateAppointment).not.toHaveBeenCalled();
  });

  it('does nothing when the mailbox is unreachable, rather than guessing', async () => {
    mockAdmin(
      { data: [REQUEST], error: null },
      { data: [], error: null }, // no verified connection
    );

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 0 });
    expect(calendarProvider.getAppointment).not.toHaveBeenCalled();
  });

  it('only considers future items of a request still awaiting a call', async () => {
    const builder = mockAdmin({ data: [], error: null });

    await repairBlankCallbackBodies({ nowMs: NOW_MS });

    // 'in_progress' was retired from this column in the 2026-08-19/20 redesign
    // (see validation/admin.ts) — a row with calendar_item_id set is
    // 'scheduled' by construction, so only 'cancelled' is excluded now.
    expect(builder.not).toHaveBeenCalledWith('status', 'eq', 'cancelled');
    expect(builder.gte).toHaveBeenCalledWith('scheduled_at', new Date(NOW_MS).toISOString());
    expect(builder.not).toHaveBeenCalledWith('calendar_item_id', 'is', null);
  });
});

// Regression for a measured incident, not a hypothetical: fourteen requests
// accumulated invisibly across the EWS→Graph migration because the sweep skips
// any row that HAS a calendar id and the reconciler only looks one day back.
// Neither reported what it skipped, so nobody knew until someone went looking.
describe('countStrandedCallbacks', () => {
  const DAY_MS = 86_400_000;

  it('counts rows past their slot that still hold a calendar id', async () => {
    mockAdmin({ data: null, error: null, count: 14 });
    await expect(countStrandedCallbacks({ nowMs: NOW_MS })).resolves.toBe(14);
  });

  it('asks only for a count — never pulls the customer rows themselves', async () => {
    const builder = mockAdmin({ data: null, error: null, count: 0 });

    await countStrandedCallbacks({ nowMs: NOW_MS });

    expect(builder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  // The three predicates ARE the definition of stranded. If any one drifts the
  // detector silently stops detecting, which is the failure it exists to catch.
  it('scopes to non-terminal rows with an id, older than the reconciler window', async () => {
    const builder = mockAdmin({ data: null, error: null, count: 0 });

    await countStrandedCallbacks({ nowMs: NOW_MS });

    expect(builder.not).toHaveBeenCalledWith('calendar_item_id', 'is', null);
    // Redesigned 2026-08-19/20 (see validation/admin.ts): 'done'/'in_progress'
    // no longer exist on this column at all — excluding the one terminal
    // value ('cancelled') instead of enumerating a closed list.
    expect(builder.not).toHaveBeenCalledWith('status', 'eq', 'cancelled');
    expect(builder.lt).toHaveBeenCalledWith(
      'scheduled_at',
      new Date(NOW_MS - DAY_MS).toISOString(),
    );
  });

  it('reports zero — never a false alarm — when the read fails', async () => {
    mockAdmin({ data: null, error: { message: 'boom' }, count: null });
    await expect(countStrandedCallbacks({ nowMs: NOW_MS })).resolves.toBe(0);
  });

  it('reports zero when the driver returns no count at all', async () => {
    mockAdmin({ data: null, error: null, count: null });
    await expect(countStrandedCallbacks({ nowMs: NOW_MS })).resolves.toBe(0);
  });
});

// Regression for a measured incident (2026-08-19): reconcileCallbacksWithCalendar
// only ever checks "does my row's appointment still exist" — never "does an
// appointment exist that no row claims". That one-directional gap let 575
// duplicate appointments accumulate over three weeks, invisibly, because a
// Graph id-mismatch bug kept releasing rows whose appointments were still live
// and each release created a NEW appointment without removing the old one.
// This is the mirror check.
function calItem(overrides: Partial<ExchangeAppointment> = {}): ExchangeAppointment {
  return {
    id: 'cal-item-1',
    subject: 'שיחה חוזרת — ישראל ישראלי',
    start: START,
    end: END,
    allDay: false,
    showAs: 'busy',
    seriesLinked: false,
    ...overrides,
  };
}

describe('countOrphanedCalendarAppointments', () => {
  it('counts a callback-subject calendar item with no matching DB row', async () => {
    mockAdmin(
      { data: [CONNECTION], error: null }, // loadBusinessConnection
      { data: [{ calendar_item_id: 'known-1' }], error: null }, // known ids
    );
    vi.mocked(calendarProvider.listAppointments).mockResolvedValue({
      ok: true,
      data: [calItem({ id: 'orphan-1' }), calItem({ id: 'known-1' })],
    });

    await expect(countOrphanedCalendarAppointments({ nowMs: NOW_MS })).resolves.toBe(1);
  });

  it('never counts an item outside the callback feature\'s own subject prefix', async () => {
    mockAdmin(
      { data: [CONNECTION], error: null },
      { data: [], error: null },
    );
    vi.mocked(calendarProvider.listAppointments).mockResolvedValue({
      ok: true,
      data: [calItem({ id: 'unrelated-1', subject: 'פגישת צוות' })],
    });

    await expect(countOrphanedCalendarAppointments({ nowMs: NOW_MS })).resolves.toBe(0);
  });

  it('reports zero, never guesses, when the mailbox is unreachable', async () => {
    mockAdmin({ data: [], error: null }); // no verified connection
    await expect(countOrphanedCalendarAppointments({ nowMs: NOW_MS })).resolves.toBe(0);
    expect(calendarProvider.listAppointments).not.toHaveBeenCalled();
  });

  it('reports zero when the calendar read fails', async () => {
    mockAdmin(
      { data: [CONNECTION], error: null },
      { data: [], error: null },
    );
    vi.mocked(calendarProvider.listAppointments).mockResolvedValue({
      ok: false,
      error: 'unreachable',
    });

    await expect(countOrphanedCalendarAppointments({ nowMs: NOW_MS })).resolves.toBe(0);
  });
});

// Regression for a measured gap (2026-08-31): reconcileCallbacksWithCalendar
// used to check ONLY whether the calendar item still existed — an owner who
// moved (not deleted) the appointment in Outlook/365 left `scheduled_at`
// stale, so the already-enqueued AI-call job kept firing at the OLD instant.
// A fake boss (send/deleteJob spies) stands in for pg-boss — these assertions
// are about WHICH job gets removed and WHICH gets (re-)enqueued, not about
// pg-boss's own wire format. deleteJob, not cancel: see reconcileCallbacksWithCalendar's
// own comment on the moved-appointment path — a deterministic job id derived
// from (request id, instant) collides with an earlier job's id when an
// appointment is moved away and later moved back to a previously-used
// instant, and pg-boss's send() silently no-ops on an id already present in
// ANY state (cancel() only clears a non-terminal one) — deleteJob() is the
// only one of the two that frees the id unconditionally.
const fakeBoss = () => ({
  send: vi.fn().mockResolvedValue('job-id'),
  deleteJob: vi.fn().mockResolvedValue(undefined),
});

const MOVED_ROW: Row = {
  id: 'req-moved-1',
  calendar_item_id: 'cal-item-1',
  scheduled_at: START.toISOString(),
  topic: 'מכירות',
};

describe('reconcileCallbacksWithCalendar — moved (not deleted) appointments', () => {
  it('corrects scheduled_at and re-enqueues the dispatch job at the new instant', async () => {
    const newStart = new Date(START.getTime() + 2 * 60 * 60 * 1000); // +2h
    mockAdmin(
      { data: [MOVED_ROW], error: null }, // rows with a calendar_item_id
      { data: [CONNECTION], error: null }, // loadBusinessConnection
      { data: null, error: null }, // scheduled_at correction UPDATE
    );
    vi.mocked(calendarProvider.listAppointments).mockResolvedValue({
      ok: true,
      data: [calItem({ id: 'cal-item-1', start: newStart })],
    });
    const boss = fakeBoss();

    const result = await reconcileCallbacksWithCalendar({ nowMs: NOW_MS, boss: boss as never });

    expect(result).toEqual({ released: 0, moved: 1 });

    // The stale job (keyed to the OLD instant) is deleted by the exact id
    // enqueueSalesCallDispatch itself derives — not a hand-typed duplicate.
    const oldMs = START.getTime();
    expect(boss.deleteJob).toHaveBeenCalledWith(
      'sales-call-dispatch',
      salesCallDispatchJobId('req-moved-1', oldMs),
    );

    // A fresh job is enqueued for the NEW instant, through the real
    // enqueueSalesCallDispatch (topic='מכירות' — meeting-confirm's own topic
    // gate means it never calls boss.send for this row).
    expect(boss.send).toHaveBeenCalledTimes(1);
    const [queueName, , sendOpts] = boss.send.mock.calls[0];
    expect(queueName).toBe('sales-call-dispatch');
    expect((sendOpts as { id: string }).id).toBe(
      salesCallDispatchJobId('req-moved-1', newStart.getTime()),
    );
  });

  it('routes a meeting-booking (non-sales) row to the meeting-confirm queue', async () => {
    const newStart = new Date(START.getTime() + 2 * 60 * 60 * 1000);
    const row: Row = { ...MOVED_ROW, topic: 'אחר' };
    mockAdmin(
      { data: [row], error: null },
      { data: [CONNECTION], error: null },
      { data: null, error: null },
    );
    vi.mocked(calendarProvider.listAppointments).mockResolvedValue({
      ok: true,
      data: [calItem({ id: 'cal-item-1', start: newStart })],
    });
    const boss = fakeBoss();

    await reconcileCallbacksWithCalendar({ nowMs: NOW_MS, boss: boss as never });

    expect(boss.deleteJob).toHaveBeenCalledWith(
      'meeting-confirm-dispatch',
      meetingConfirmDispatchJobId('req-moved-1', START.getTime()),
    );
    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send.mock.calls[0][0]).toBe('meeting-confirm-dispatch');
  });

  it('ignores sub-minute drift — that is serialization noise, not a real move', async () => {
    const barelyMoved = new Date(START.getTime() + 30_000); // +30s
    mockAdmin(
      { data: [MOVED_ROW], error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.listAppointments).mockResolvedValue({
      ok: true,
      data: [calItem({ id: 'cal-item-1', start: barelyMoved })],
    });
    const boss = fakeBoss();

    const result = await reconcileCallbacksWithCalendar({ nowMs: NOW_MS, boss: boss as never });

    expect(result).toEqual({ released: 0, moved: 0 });
    expect(boss.deleteJob).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('corrects the DB but touches no pg-boss job when no boss is supplied', async () => {
    const newStart = new Date(START.getTime() + 2 * 60 * 60 * 1000);
    mockAdmin(
      { data: [MOVED_ROW], error: null },
      { data: [CONNECTION], error: null },
      { data: null, error: null }, // scheduled_at correction still happens
    );
    vi.mocked(calendarProvider.listAppointments).mockResolvedValue({
      ok: true,
      data: [calItem({ id: 'cal-item-1', start: newStart })],
    });

    const result = await reconcileCallbacksWithCalendar({ nowMs: NOW_MS });

    expect(result).toEqual({ released: 0, moved: 1 });
  });
});

// Redesigned 2026-08-20: closing a request used to DELETE the appointment
// outright, erasing any trace it was ever scheduled or how it ended. It now
// MUTES the appointment in place instead — cancels the reminder, frees the
// slot, marks the subject/category — and never deletes it again.
describe('closeCallbackAppointment', () => {
  it('archives the appointment in place (never deletes) and clears the link', async () => {
    mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null }, // row lookup
      { data: [CONNECTION], error: null }, // loadBusinessConnection
      { data: null, error: null }, // clearing update
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await expect(closeCallbackAppointment('req-1')).resolves.toEqual({ archived: true });
    expect(calendarProvider.deleteAppointment).not.toHaveBeenCalled();
    const [, itemId, update] = vi.mocked(calendarProvider.updateAppointment).mock.calls[0];
    expect(itemId).toBe('item-1');
    expect(update.reminderMinutes).toBe(0);
    expect(update.showAs).toBe('free');
    expect(update.category).toBe('KALFA — שיחה שהושלמה');
    expect(update.subject).toBe('✓ שיחה חוזרת — ישראל ישראלי');
    // A repair/archive writes cosmetic fields only — the slot the owner has
    // already seen must not move under them.
    expect(update.start).toEqual(START);
    expect(update.end).toEqual(END);
  });

  it('marks a cancellation differently from a completed call', async () => {
    mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null },
      { data: [CONNECTION], error: null },
      { data: null, error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await closeCallbackAppointment('req-1', { reason: 'cancelled' });

    const [, , update] = vi.mocked(calendarProvider.updateAppointment).mock.calls[0];
    expect(update.category).toBe('KALFA — בוטל');
    expect(update.subject).toBe('✗ בוטל: שיחה חוזרת — ישראל ישראלי');
  });

  it('re-closing an already-archived subject replaces the mark instead of stacking it', async () => {
    mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null },
      { data: [CONNECTION], error: null },
      { data: null, error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({
      ok: true,
      data: { ...appointment(''), subject: '✓ שיחה חוזרת — ישראל ישראלי' },
    });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await closeCallbackAppointment('req-1', { reason: 'cancelled' });

    const [, , update] = vi.mocked(calendarProvider.updateAppointment).mock.calls[0];
    expect(update.subject).toBe('✗ בוטל: שיחה חוזרת — ישראל ישראלי');
  });

  it('treats an already-gone appointment (not_found) as success without touching updateAppointment', async () => {
    mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null },
      { data: [CONNECTION], error: null },
      { data: null, error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: false, error: 'not_found' });

    await expect(closeCallbackAppointment('req-1')).resolves.toEqual({ archived: true });
    expect(calendarProvider.updateAppointment).not.toHaveBeenCalled();
  });

  it('does nothing when the request never had a calendar appointment', async () => {
    mockAdmin({ data: { calendar_item_id: null }, error: null });

    await expect(closeCallbackAppointment('req-1')).resolves.toEqual({ archived: false });
    expect(calendarProvider.getAppointment).not.toHaveBeenCalled();
  });

  it('keeps the link when archiving genuinely fails, rather than losing track of it', async () => {
    const builder = mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: false, error: 'unreachable' });

    await expect(closeCallbackAppointment('req-1')).resolves.toEqual({ archived: false });
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('does nothing when the mailbox is unreachable', async () => {
    mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null },
      { data: [], error: null }, // no verified connection
    );

    await expect(closeCallbackAppointment('req-1')).resolves.toEqual({ archived: false });
    expect(calendarProvider.getAppointment).not.toHaveBeenCalled();
  });
});

// Regression for the scenario raised 19.08: the caller answered and either
// asked for a different time than originally requested, or asked to be
// called again later ("let me think about it"). Both need the SAME thing —
// close whatever slot exists, open a fresh one from a new instant.
describe('rescheduleCallbackRequest', () => {
  const NEW_ISO = '2026-09-01T10:00:00.000Z';

  it('closes the existing appointment and opens a new slot from the given instant', async () => {
    const builder = mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null }, // reschedule's own row lookup
      { data: { calendar_item_id: 'item-1' }, error: null }, // closeCallbackAppointment's row lookup
      { data: [CONNECTION], error: null }, // closeCallbackAppointment's loadBusinessConnection
      { data: null, error: null }, // closeCallbackAppointment's clearing update
      { data: null, error: null }, // reschedule's own final update
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await expect(rescheduleCallbackRequest('req-1', NEW_ISO)).resolves.toEqual({ ok: true });
    // Distinct from 'new': the admin list needs to tell "never touched" apart
    // from "was scheduled, now needs a fresh time" (2026-08-19/20 redesign).
    expect(builder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'needs_reschedule',
        requested_at: NEW_ISO,
        requested_rank: 'nearest',
        scheduling_failure_reason: null,
      }),
    );
  });

  it('skips closing when there was never an appointment to begin with', async () => {
    mockAdmin(
      { data: { calendar_item_id: null }, error: null }, // nothing to close
      { data: null, error: null }, // final update
    );

    await expect(rescheduleCallbackRequest('req-1', NEW_ISO)).resolves.toEqual({ ok: true });
    expect(calendarProvider.deleteAppointment).not.toHaveBeenCalled();
  });

  it('refuses to proceed when the old appointment cannot be closed — never orphans a duplicate', async () => {
    const builder = mockAdmin(
      { data: { calendar_item_id: 'item-1' }, error: null },
      { data: { calendar_item_id: 'item-1' }, error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: false, error: 'unreachable' });

    await expect(rescheduleCallbackRequest('req-1', NEW_ISO)).resolves.toEqual({
      ok: false,
      reason: 'old_appointment_not_removed',
    });
    // The row that would let the sweep create a second appointment is never touched.
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('reports not_found for a request that does not exist', async () => {
    mockAdmin({ data: null, error: null });
    await expect(rescheduleCallbackRequest('missing', NEW_ISO)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

// Design settled 2026-08-20 (owner + friend's CRM-informed review, and the
// atomicity correction that followed it): recording a call outcome archives
// the attempt's appointment, decides whether the REQUEST itself closes or
// re-enters scheduling, and — for the third consecutive no_answer — closes
// the request as no_contact and sends a one-time SMS. Everything is claimed
// in ONE update statement, guarded on calendar_item_id still matching what
// was just read, so a duplicate submission for the SAME attempt (double
// click, two tabs, a retried request) can never double-process.
describe('applyCallOutcome', () => {
  function outcomeRow(overrides: Partial<Row> = {}): Row {
    return {
      id: 'req-1',
      full_name: 'ישראל ישראלי',
      phone: '+972532743588',
      attempt_count: 0,
      consecutive_no_answer_count: 0,
      calendar_item_id: 'item-1',
      ...overrides,
    };
  }

  it('does nothing for "pending" — no read, no write, no archive', async () => {
    mockAdmin();
    const result = await applyCallOutcome('req-1', 'pending');
    expect(result).toEqual({ archived: false, requestClosed: false });
    expect(calendarProvider.getAppointment).not.toHaveBeenCalled();
  });

  it('a duplicate submission for the same attempt does nothing — the claim fails', async () => {
    mockAdmin(
      { data: outcomeRow(), error: null }, // row read
      { data: null, error: null }, // CAS claim — 0 rows matched, already handled
    );

    const result = await applyCallOutcome('req-1', 'no_answer');

    expect(result).toEqual({ archived: false, requestClosed: false });
    expect(calendarProvider.getAppointment).not.toHaveBeenCalled();
    expect(getSmsSender).not.toHaveBeenCalled();
  });

  it('a fresh no_answer (not yet 3) archives, increments both counters, and re-enters scheduling', async () => {
    const builder = mockAdmin(
      { data: outcomeRow(), error: null }, // row read
      { data: { id: 'req-1' }, error: null }, // CAS claim succeeds
      { data: [CONNECTION], error: null }, // loadBusinessConnection
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    const result = await applyCallOutcome('req-1', 'no_answer');

    expect(result).toEqual({ archived: true, requestClosed: false });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        call_outcome: 'no_answer',
        consecutive_no_answer_count: 1,
        attempt_count: 1,
        status: 'pending_schedule',
        calendar_item_id: null,
        exchange_connection_id: null,
        scheduled_at: null,
        scheduling_failure_reason: null,
      }),
    );
    expect(getSmsSender).not.toHaveBeenCalled();
  });

  it('the third consecutive no_answer closes the request as no_contact and sends the SMS exactly once', async () => {
    const builder = mockAdmin(
      { data: outcomeRow({ consecutive_no_answer_count: 2 }), error: null }, // row read
      { data: { id: 'req-1' }, error: null }, // CAS claim succeeds
      { data: [CONNECTION], error: null }, // loadBusinessConnection
      { data: { id: 'req-1' }, error: null }, // SMS send-claim succeeds
      { data: null, error: null }, // SMS success write (sent_at + provider_id)
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });
    const send = vi.fn().mockResolvedValue({ id: 'sms-1' });
    vi.mocked(getSmsSender).mockResolvedValue({ send });

    const result = await applyCallOutcome('req-1', 'no_answer');

    expect(result).toEqual({ archived: true, requestClosed: true });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        call_outcome: 'no_contact',
        status: 'closed',
        consecutive_no_answer_count: 3,
        calendar_item_id: null,
      }),
    );
    expect(send).toHaveBeenCalledWith({
      to: '+972532743588',
      text: expect.stringContaining('שלום ישראל ישראלי'),
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('https://beta.kalfa.me/contact') }),
    );
    expect(builder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ no_contact_sms_sent_at: expect.any(String), no_contact_sms_provider_id: 'sms-1' }),
    );
  });

  it('never calls the SMS provider when the send was already claimed by an earlier run', async () => {
    mockAdmin(
      { data: outcomeRow({ consecutive_no_answer_count: 2 }), error: null },
      { data: { id: 'req-1' }, error: null }, // CAS claim succeeds
      { data: [CONNECTION], error: null },
      { data: null, error: null }, // SMS send-claim — already taken
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    await applyCallOutcome('req-1', 'no_answer');

    expect(getSmsSender).not.toHaveBeenCalled();
  });

  it('needs_followup resets the streak and re-enters scheduling, without touching attempt_count', async () => {
    const builder = mockAdmin(
      { data: outcomeRow({ consecutive_no_answer_count: 2, attempt_count: 1 }), error: null },
      { data: { id: 'req-1' }, error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    const result = await applyCallOutcome('req-1', 'needs_followup');

    expect(result).toEqual({ archived: true, requestClosed: false });
    const [payload] = vi.mocked(builder.update).mock.calls[0];
    expect(payload).toMatchObject({
      call_outcome: 'needs_followup',
      consecutive_no_answer_count: 0,
      status: 'pending_schedule',
    });
    expect(payload).not.toHaveProperty('attempt_count');
  });

  it.each(['completed', 'closed'] as const)(
    'a terminal outcome (%s) resets the streak and closes the request',
    async (outcome) => {
      const builder = mockAdmin(
        { data: outcomeRow({ consecutive_no_answer_count: 1 }), error: null },
        { data: { id: 'req-1' }, error: null },
        { data: [CONNECTION], error: null },
      );
      vi.mocked(calendarProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
      vi.mocked(calendarProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

      const result = await applyCallOutcome('req-1', outcome);

      expect(result).toEqual({ archived: true, requestClosed: true });
      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ call_outcome: outcome, consecutive_no_answer_count: 0, status: 'closed' }),
      );
    },
  );
});
