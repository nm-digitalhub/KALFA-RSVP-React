import { describe, expect, it } from 'vitest';

import {
  defaultThankyouSendAt,
  ilDateInputValue,
  ilTimeInputValue,
  ilWallTimeToIso,
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

  it('returns null for a calendar or clock value that does not exist instead of rolling it into another date', () => {
    expect(wallClockToDate('2026-02-30T10:00', IL)).toBeNull();
    expect(wallClockToDate('2026-13-01T10:00', IL)).toBeNull();
    expect(wallClockToDate('2026-10-00T10:00', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T25:00', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T10:61', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T24:01', IL)).toBeNull();
  });

  // Hour is 0..23. 24:00 used to be read as "the end of the day" and rolled into the next one.
  it('does not accept 24:00 as a wall-clock time — it is invalid, not the next day', () => {
    expect(wallClockToDate('2026-03-26T24:00', IL)).toBeNull();
    expect(wallClockToDate('2026-03-26T24:00:00', IL)).toBeNull();
    expect(iso(wallClockToDate('2026-03-26T23:59:59', IL))).toBe('2026-03-26T21:59:59.000Z'); // last valid second
    expect(iso(wallClockToDate('2026-03-27T00:00', IL))).toBe('2026-03-26T22:00:00.000Z'); // the next day's 00:00
  });

  // Regression (13.10.2026): the offset used to be looked up at NOON of the date, which is the wrong
  // offset for every wall time before the 02:00 switch on the two DST days a year.
  it('uses the offset in force at that very instant on the spring-forward day (01:00 is still IST, +02:00)', () => {
    // Israel 2026: clocks go 02:00 -> 03:00 on Friday 27.3.
    expect(iso(wallClockToDate('2026-03-27T01:00', IL))).toBe('2026-03-26T23:00:00.000Z');
    expect(iso(wallClockToDate('2026-03-27T03:30', IL))).toBe('2026-03-27T00:30:00.000Z'); // IDT, +03:00
  });

  it('uses the offset in force at that very instant on the fall-back day (00:30 is still IDT, +03:00)', () => {
    // Israel 2026: clocks go 02:00 -> 01:00 on Sunday 25.10.
    expect(iso(wallClockToDate('2026-10-25T00:30', IL))).toBe('2026-10-24T21:30:00.000Z');
    expect(iso(wallClockToDate('2026-10-25T02:30', IL))).toBe('2026-10-25T00:30:00.000Z'); // IST, +02:00
  });
});

// The same primitive, rendered as the ISO text with the LOCAL offset that the callers store and parse.
describe('ilWallTimeToIso', () => {
  const instant = (text: string) => new Date(text).toISOString();

  it('returns the plain date untouched when there is no time (legacy date-only contract)', () => {
    expect(ilWallTimeToIso('2026-03-27', '')).toBe('2026-03-27');
    expect(ilWallTimeToIso('2026-10-25', '')).toBe('2026-10-25');
  });

  it('carries the local offset of the date: +02:00 in winter, +03:00 in summer', () => {
    expect(ilWallTimeToIso('2026-01-15', '09:30')).toBe('2026-01-15T09:30:00+02:00');
    expect(ilWallTimeToIso('2026-07-15', '09:30')).toBe('2026-07-15T09:30:00+03:00');
  });

  // Regression (13.10.2026) — the two proven faults.
  it('2026-03-27 01:00 is IST: 2026-03-26T23:00Z, not an hour earlier', () => {
    const text = ilWallTimeToIso('2026-03-27', '01:00');
    expect(text).toBe('2026-03-27T01:00:00+02:00');
    expect(instant(text)).toBe('2026-03-26T23:00:00.000Z');
  });

  it('2026-10-25 00:30 is IDT: 2026-10-24T21:30Z, not an hour later', () => {
    const text = ilWallTimeToIso('2026-10-25', '00:30');
    expect(text).toBe('2026-10-25T00:30:00+03:00');
    expect(instant(text)).toBe('2026-10-24T21:30:00.000Z');
  });

  it('uses the new offset for the hours after the switch', () => {
    expect(ilWallTimeToIso('2026-03-27', '03:30')).toBe('2026-03-27T03:30:00+03:00');
    expect(ilWallTimeToIso('2026-10-25', '02:30')).toBe('2026-10-25T02:30:00+02:00');
  });

  it('gets Israel midnight right on both switch days and the days around them', () => {
    expect(instant(ilWallTimeToIso('2026-03-27', '00:00'))).toBe('2026-03-26T22:00:00.000Z');
    expect(instant(ilWallTimeToIso('2026-03-28', '00:00'))).toBe('2026-03-27T21:00:00.000Z');
    expect(instant(ilWallTimeToIso('2026-10-25', '00:00'))).toBe('2026-10-24T21:00:00.000Z');
    expect(instant(ilWallTimeToIso('2026-10-26', '00:00'))).toBe('2026-10-25T22:00:00.000Z');
  });

  it('puts a time inside the spring-forward gap just after it, and one in the autumn overlap on one of its two instants', () => {
    expect(ilWallTimeToIso('2026-03-27', '02:30')).toBe('2026-03-27T03:30:00+03:00');
    expect(['2026-10-25T01:30:00+03:00', '2026-10-25T01:30:00+02:00']).toContain(
      ilWallTimeToIso('2026-10-25', '01:30'),
    );
  });

  it('rejects 24:00 instead of reading it as the end of the day', () => {
    expect(() => ilWallTimeToIso('2026-03-26', '24:00')).toThrow(RangeError);
    expect(instant(ilWallTimeToIso('2026-03-27', '00:00'))).toBe('2026-03-26T22:00:00.000Z');
  });

  it('fails with a RangeError for a wall clock that cannot be read or does not exist — no offset-less text', () => {
    expect(() => ilWallTimeToIso('not-a-date', '10:00')).toThrow(RangeError);
    expect(() => ilWallTimeToIso('2026-13-01', '10:00')).toThrow(RangeError);
    expect(() => ilWallTimeToIso('2026-02-30', '10:00')).toThrow(RangeError);
    expect(() => ilWallTimeToIso('2026-03-27', '25:00')).toThrow(RangeError);
    expect(() => ilWallTimeToIso('2026-03-27', '10:61')).toThrow(RangeError);
    expect(() => ilWallTimeToIso('2026-03-27', '9:00')).toThrow(RangeError);
    expect(() => ilWallTimeToIso('2026-03-27', 'noon')).toThrow(/not an Israel wall-clock/);
  });

  it('with no time it stays the plain date, whatever it contains (the date-only contract is untouched)', () => {
    expect(ilWallTimeToIso('2026-03-27', '')).toBe('2026-03-27');
    expect(ilWallTimeToIso('not-a-date', '')).toBe('not-a-date');
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

  // The meaning is "10:00 Israel on the next CALENDAR day", the rule sync_campaign_window_from_event applies
  // in SQL — not the event instant + 24h, which is a day off for the hour after midnight on a DST day.
  it('a 00:30 event on the 25-hour fall-back day gets its thank-you on the 26th, not the 25th', () => {
    // 2026-10-25 00:30 IDT = 2026-10-24T21:30Z; +24h would read 23:30 on the 25th.
    const iso = defaultThankyouSendAt('2026-10-25T00:30:00+03:00');
    expect(iso).toBe('2026-10-26T10:00:00+02:00');
    expect(new Date(iso!).toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });

  it('a 23:30 event the evening before the spring switch gets its thank-you on the 27th, not the 28th', () => {
    // 2026-03-26 23:30 IST = 21:30Z; +24h would read 00:30 on the 28th.
    const iso = defaultThankyouSendAt('2026-03-26T23:30:00+02:00');
    expect(iso).toBe('2026-03-27T10:00:00+03:00');
    expect(new Date(iso!).toISOString()).toBe('2026-03-27T07:00:00.000Z');
  });

  it('an event on the 23-hour spring day and one on the 25-hour autumn day both resolve to the next day 10:00', () => {
    expect(defaultThankyouSendAt('2026-03-27T23:30:00+03:00')).toBe('2026-03-28T10:00:00+03:00');
    expect(defaultThankyouSendAt('2026-10-25T23:30:00+02:00')).toBe('2026-10-26T10:00:00+02:00');
  });

  it('the day after is a calendar day across a month and a year end', () => {
    expect(defaultThankyouSendAt('2026-07-31T20:00:00+03:00')).toBe('2026-08-01T10:00:00+03:00');
    expect(defaultThankyouSendAt('2026-12-31T20:00:00+02:00')).toBe('2027-01-01T10:00:00+02:00');
  });

  it('handles null/unparseable event_date by returning null', () => {
    expect(defaultThankyouSendAt(null)).toBeNull();
    expect(defaultThankyouSendAt('not-a-date')).toBeNull();
  });
});
