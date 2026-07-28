import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.kalfa.me') }));
vi.mock('@/lib/exchange-ews/crypto', () => ({ decryptCredential: vi.fn(() => 'pw') }));
vi.mock('@/lib/exchange-ews/ews-impl', () => ({
  ewsProvider: {
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
import { ewsProvider } from '@/lib/exchange-ews/ews-impl';
import { buildCallbackDraft } from '@/lib/callbacks/calendar-item';
import type { ExchangeAppointmentDetail } from '@/lib/exchange-ews/types';
import {
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

// The description is the only part of the item that carries the number to dial.
// An appointment that reaches the mailbox without one is indistinguishable from
// a scheduled call until someone opens it with the phone already in their hand.
describe('scheduleCallbackAppointment — empty-body guard', () => {
  it('refuses to create an appointment whose description came out blank', async () => {
    mockAdmin(
      { data: [CONNECTION], error: null }, // loadBusinessConnection
      { data: [], error: null }, // countScheduledPerDay
    );
    vi.mocked(ewsProvider.getAvailability).mockResolvedValue({ ok: true, data: [] });
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
    expect(ewsProvider.createAppointment).not.toHaveBeenCalled();
  });
});

describe('repairBlankCallbackBodies', () => {
  it('fills in a blank description with exactly what a fresh create would write', async () => {
    mockAdmin(
      { data: [REQUEST], error: null }, // candidate rows
      { data: [CONNECTION], error: null }, // loadBusinessConnection
    );
    vi.mocked(ewsProvider.getAppointment).mockResolvedValue({ ok: true, data: appointment('') });
    vi.mocked(ewsProvider.updateAppointment).mockResolvedValue({ ok: true, data: undefined });

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 1 });
    const [, itemId, update] = vi.mocked(ewsProvider.updateAppointment).mock.calls[0];
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
    vi.mocked(ewsProvider.getAppointment).mockResolvedValue({
      ok: true,
      data: appointment('להתקשר אחרי 14:00'),
    });

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 0 });
    expect(ewsProvider.updateAppointment).not.toHaveBeenCalled();
  });

  it('leaves an unreadable appointment to the reconcile pass', async () => {
    mockAdmin(
      { data: [REQUEST], error: null },
      { data: [CONNECTION], error: null },
    );
    vi.mocked(ewsProvider.getAppointment).mockResolvedValue({ ok: false, error: 'not_found' });

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 0 });
    expect(ewsProvider.updateAppointment).not.toHaveBeenCalled();
  });

  it('does nothing when the mailbox is unreachable, rather than guessing', async () => {
    mockAdmin(
      { data: [REQUEST], error: null },
      { data: [], error: null }, // no verified connection
    );

    const result = await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(result).toEqual({ repaired: 0 });
    expect(ewsProvider.getAppointment).not.toHaveBeenCalled();
  });

  it('only considers future items of a request still awaiting a call', async () => {
    const builder = mockAdmin({ data: [], error: null });

    await repairBlankCallbackBodies({ nowMs: NOW_MS });

    expect(builder.in).toHaveBeenCalledWith('status', ['new', 'in_progress']);
    expect(builder.gte).toHaveBeenCalledWith('scheduled_at', new Date(NOW_MS).toISOString());
    expect(builder.not).toHaveBeenCalledWith('calendar_item_id', 'is', null);
  });
});
