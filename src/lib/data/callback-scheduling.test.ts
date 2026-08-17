import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.kalfa.me') }));
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
import type { ExchangeAppointmentDetail } from '@/lib/exchange-ews/types';
import {
  countStrandedCallbacks,
  repairBlankCallbackBodies,
  scheduleCallbackAppointment,
  type SchedulableCallback,
} from '@/lib/data/callback-scheduling';

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

    expect(builder.in).toHaveBeenCalledWith('status', ['new', 'in_progress']);
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
    expect(builder.not).toHaveBeenCalledWith('status', 'in', '(completed,cancelled)');
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
