import { describe, expect, it } from 'vitest';

import {
  defaultThankyouSendAt,
  ilDateInputValue,
  ilTimeInputValue,
  rsvpClosedReason,
  wallClockToDate,
} from './event-date';

// The suite runs under the TZ pinned in vitest.config.mts (Asia/Jerusalem).
// That matters only for the fall-back overlap below, whose result depends on
// the host zone; every other case here holds under any host zone.
describe('wallClockToDate', () => {
  const IL = 'Asia/Jerusalem';
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('reads the wall time IN the given zone — the 06:36 that was saved as 10:36 (incident 2026-10-07)', () => {
    // Israel is UTC+3 on that date: 06:36 there is 03:36Z. Stored as the raw
    // string it became 06:36Z, three hours late.
    expect(iso(wallClockToDate('2026-10-07T06:36', IL))).toBe('2026-10-07T03:36:00.000Z');
  });

  it('follows the offset of the date in question, not today’s', () => {
    // IST (UTC+2) in January, IDT (UTC+3) in July.
    expect(iso(wallClockToDate('2026-01-15T09:30', IL))).toBe('2026-01-15T07:30:00.000Z');
    expect(iso(wallClockToDate('2026-07-15T09:30', IL))).toBe('2026-07-15T06:30:00.000Z');
  });

  it('honours the zone argument and accepts seconds and a space separator', () => {
    expect(iso(wallClockToDate('2026-10-07T06:36', 'UTC'))).toBe('2026-10-07T06:36:00.000Z');
    expect(iso(wallClockToDate('2026-10-07T06:36', 'Asia/Singapore'))).toBe('2026-10-06T22:36:00.000Z');
    expect(iso(wallClockToDate('2026-10-07T06:36:30', IL))).toBe('2026-10-07T03:36:30.000Z');
    expect(iso(wallClockToDate('2026-10-07 06:36', IL))).toBe('2026-10-07T03:36:00.000Z');
  });

  it('puts a wall time inside the spring-forward gap just after it', () => {
    // 2027-03-26 02:00 → 03:00 in Israel: 02:30 does not exist and resolves to
    // 03:30 IDT = 00:30Z.
    expect(iso(wallClockToDate('2027-03-26T02:30', IL))).toBe('2027-03-26T00:30:00.000Z');
  });

  it('resolves a wall time in the fall-back overlap to one of its two instants', () => {
    // 2026-10-25 02:00 → 01:00: 01:30 happens twice, 22:30Z (IDT) and 23:30Z
    // (IST). Which one is host-zone dependent, so only the pair is asserted.
    expect(['2026-10-24T22:30:00.000Z', '2026-10-24T23:30:00.000Z']).toContain(
      iso(wallClockToDate('2026-10-25T01:30', IL)),
    );
  });

  it('returns null — never throws — for text it cannot read or a zone it cannot resolve', () => {
    expect(wallClockToDate('', IL)).toBeNull();
    expect(wallClockToDate('not a date', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T06:36', 'Not/AZone')).toBeNull();
  });
});

describe('ilDateInputValue', () => {
  it('passes a plain date column value through unchanged', () => {
    expect(ilDateInputValue('2026-07-12')).toBe('2026-07-12');
  });

  it('returns the ISRAEL calendar day of a timestamptz instant', () => {
    // 17:30 IDT stored as 14:30Z — same calendar day.
    expect(ilDateInputValue('2026-07-12T14:30:00+00:00')).toBe('2026-07-12');
    // 01:00 IDT stored as 22:00Z the PREVIOUS day — a raw slice(0,10) would
    // prefill the form with the 11th; the Israel day is the 12th.
    expect(ilDateInputValue('2026-07-11T22:00:00+00:00')).toBe('2026-07-12');
  });

  it('handles empty and invalid values', () => {
    expect(ilDateInputValue(null)).toBe('');
    expect(ilDateInputValue('')).toBe('');
    expect(ilDateInputValue('not-a-date')).toBe('');
  });
});

describe('ilTimeInputValue', () => {
  it('returns the IL wall-clock time of a stored instant', () => {
    expect(ilTimeInputValue('2026-07-12T14:30:00+00:00')).toBe('17:30');
  });

  it('treats legacy date-only (midnight UTC) values as "no time set"', () => {
    expect(ilTimeInputValue('2026-07-12')).toBe('');
    expect(ilTimeInputValue('2026-07-12T00:00:00+00:00')).toBe('');
  });
});

// The shared gate both dial paths ask before placing a call. Each case mirrors
// one of submit_rsvp's event-level refusals — if these drift from the SQL, a
// call gets placed whose answer the database will refuse to write.
describe('rsvpClosedReason', () => {
  // 2026-07-21 12:00 IDT — the day the three un-writable bridge calls went out.
  const NOW = Date.parse('2026-07-21T09:00:00+00:00');
  const open = { eventStatus: 'active', eventDate: '2026-08-01T18:00:00+03:00', rsvpDeadline: null };

  it('returns null for an active, future event with no deadline', () => {
    expect(rsvpClosedReason(open, NOW)).toBeNull();
  });

  it('refuses a non-active event before looking at any date', () => {
    expect(rsvpClosedReason({ ...open, eventStatus: 'draft' }, NOW)).toBe('event_not_active');
    expect(rsvpClosedReason({ ...open, eventStatus: 'cancelled' }, NOW)).toBe('event_not_active');
  });

  it('refuses a past event day — the real 2026-07-12 brit, judged on 07-21', () => {
    expect(
      rsvpClosedReason({ ...open, eventDate: '2026-07-12T20:00:00+03:00' }, NOW),
    ).toBe('past_event_day');
  });

  it('allows an event happening TODAY — it rides through its own day', () => {
    expect(rsvpClosedReason({ ...open, eventDate: '2026-07-21T20:00:00+03:00' }, NOW)).toBeNull();
    // …including one whose Israel day is today but whose UTC instant is yesterday.
    expect(rsvpClosedReason({ ...open, eventDate: '2026-07-20T22:30:00+00:00' }, NOW)).toBeNull();
  });

  it('refuses a passed deadline even when the event is still in the future', () => {
    expect(rsvpClosedReason({ ...open, rsvpDeadline: '2026-07-20' }, NOW)).toBe('deadline_passed');
  });

  it('allows a deadline of TODAY — the SQL compares strictly greater-than', () => {
    expect(rsvpClosedReason({ ...open, rsvpDeadline: '2026-07-21' }, NOW)).toBeNull();
    expect(rsvpClosedReason({ ...open, rsvpDeadline: '2026-07-22' }, NOW)).toBeNull();
  });

  it('does not gate on a null/unparseable event_date (mirrors the DB NULL semantics)', () => {
    expect(rsvpClosedReason({ ...open, eventDate: null }, NOW)).toBeNull();
    expect(rsvpClosedReason({ ...open, eventDate: 'not-a-date' }, NOW)).toBeNull();
  });
});

describe('defaultThankyouSendAt', () => {
  it('resolves to 10:00 the morning after the event, IDT (summer, +03:00)', () => {
    // Event on 2026-07-12 (Israel day) → default fires 2026-07-13 10:00 IDT
    // = 07:00Z.
    const iso = defaultThankyouSendAt('2026-07-12T17:00:00+03:00');
    expect(iso).toBe('2026-07-13T10:00:00+03:00');
    expect(new Date(iso!).toISOString()).toBe('2026-07-13T07:00:00.000Z');
  });

  it('resolves to 10:00 the morning after the event, IST (winter, +02:00)', () => {
    // Event on 2026-01-12 (Israel day) → default fires 2026-01-13 10:00 IST
    // = 08:00Z.
    const iso = defaultThankyouSendAt('2026-01-12T17:00:00+02:00');
    expect(iso).toBe('2026-01-13T10:00:00+02:00');
    expect(new Date(iso!).toISOString()).toBe('2026-01-13T08:00:00.000Z');
  });

  it('crosses a DST transition correctly (event the day before clocks change)', () => {
    // Israel switched IDT->IST on 2025-10-26 (example transition). An event
    // the evening before should default to the NEXT (winter-offset) morning.
    const iso = defaultThankyouSendAt('2025-10-25T20:00:00+03:00');
    expect(iso).toBe('2025-10-26T10:00:00+02:00');
  });

  it('handles null/unparseable event_date by returning null', () => {
    expect(defaultThankyouSendAt(null)).toBeNull();
    expect(defaultThankyouSendAt('not-a-date')).toBeNull();
  });
});
