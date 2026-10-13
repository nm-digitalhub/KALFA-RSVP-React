import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHostRunner, HOST_ZONES, type HostRunner } from '@/test/host-zone';

import {
  defaultThankyouSendAt,
  ilDateInputValue,
  ilTimeInputValue,
  ilWallTimeToIso,
  rsvpClosedReason,
  wallClockToDate,
} from './event-date';

// The suite runs under the TZ pinned in vitest.config.mts (Asia/Jerusalem), but nothing here depends on it:
// the DST contract below is host-independent, and 'host zone matrix' proves it by running the real resolver in
// fresh processes whose host zone is something else.
//
// Correctness expectations in this file are written out by hand or derived from Intl alone (an explicit zone
// passed to Intl.DateTimeFormat). None is computed with Temporal, @date-fns/tz, tzOffset or tzScan: a test that
// asks the implementation's own machinery for the answer cannot catch that machinery being wrong.
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

  it('resolves a wall time in the fall-back overlap to its EARLIER occurrence', () => {
    // 2026-10-25 02:00 → 01:00: 01:30 happens twice, 22:30Z (IDT, +03:00) and
    // 23:30Z (IST, +02:00). The earlier one wins, whatever the host zone.
    expect(iso(wallClockToDate('2026-10-25T01:30', IL))).toBe('2026-10-24T22:30:00.000Z');
  });

  it('returns null — never throws — for text it cannot read or a zone it cannot resolve', () => {
    expect(wallClockToDate('', IL)).toBeNull();
    expect(wallClockToDate('not a date', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T06:36', 'Not/AZone')).toBeNull();
    expect(wallClockToDate('2026-10-07T06:36', '')).toBeNull();
  });

  it('returns null for a calendar or clock value that does not exist instead of rolling it into another date', () => {
    expect(wallClockToDate('2026-02-30T10:00', IL)).toBeNull();
    expect(wallClockToDate('2026-02-29T10:00', IL)).toBeNull(); // 2026 is not a leap year
    expect(wallClockToDate('2100-02-29T10:00', IL)).toBeNull(); // 2100 is not a leap year either
    expect(wallClockToDate('2026-13-01T10:00', IL)).toBeNull();
    expect(wallClockToDate('2026-10-00T10:00', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T25:00', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T10:61', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T24:01', IL)).toBeNull();
    expect(wallClockToDate('2026-10-07T10:30:60', IL)).toBeNull();
    // A real leap day is a real day.
    expect(iso(wallClockToDate('2028-02-29T10:00', IL))).toBe('2028-02-29T08:00:00.000Z');
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

// The text format: HH:mm, HH:mm:ss, HH:mm:ss.S to .SSSSSSSSS — and nothing after it.
describe('wall-clock text format', () => {
  const IL = 'Asia/Jerusalem';
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('keeps milliseconds: a fraction of 1 to 3 digits is exact, longer ones are cut to the millisecond (never rounded)', () => {
    expect(iso(wallClockToDate('2026-07-15T09:30:00', IL))).toBe('2026-07-15T06:30:00.000Z');
    expect(iso(wallClockToDate('2026-07-15T09:30:00.1', IL))).toBe('2026-07-15T06:30:00.100Z');
    expect(iso(wallClockToDate('2026-07-15T09:30:00.12', IL))).toBe('2026-07-15T06:30:00.120Z');
    expect(iso(wallClockToDate('2026-07-15T09:30:00.123', IL))).toBe('2026-07-15T06:30:00.123Z');
    expect(iso(wallClockToDate('2026-07-15T09:30:00.123456789', IL))).toBe('2026-07-15T06:30:00.123Z');
    // 7 digits is what Microsoft Graph writes ("…T00:00:00.0000000"); 9999999 must not round up into the next second.
    expect(iso(wallClockToDate('2026-07-15T00:00:00.0000000', IL))).toBe('2026-07-14T21:00:00.000Z');
    expect(iso(wallClockToDate('2026-07-15T09:30:00.9999999', IL))).toBe('2026-07-15T06:30:00.999Z');
  });

  it('keeps the milliseconds through the overlap and the gap too', () => {
    expect(iso(wallClockToDate('2026-10-25T01:30:00.123', IL))).toBe('2026-10-24T22:30:00.123Z');
    expect(iso(wallClockToDate('2026-03-27T02:30:00.456', IL))).toBe('2026-03-27T00:30:00.456Z');
  });

  it('is anchored to the end of the text: a zone designator, an offset, a dangling dot, spaces, a newline or junk refuse it', () => {
    for (const text of [
      '2026-10-25T01:30Z',
      '2026-10-25T01:30:00Z',
      '2026-10-25T01:30:00.123Z',
      '2026-10-25T01:30:00+03:00',
      '2026-10-25T01:30:00.',
      '2026-10-25T01:30:00.1234567890', // ten digits
      '2026-10-25T01:30:00.123 extra',
      ' 2026-10-25T01:30',
      '2026-10-25T01:30 ',
      '2026-10-25T01:30\n',
      'x2026-10-25T01:30',
      '2026-10-25T01:3',
      '2026-10-25T1:30',
      '2026-10-25T01:30:5',
      '2026-10-25T01:30.5',
      '26-10-25T01:30',
    ]) {
      expect(wallClockToDate(text, IL), JSON.stringify(text)).toBeNull();
    }
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

  it('puts a time inside the spring-forward gap just after it, and one in the autumn overlap on its earlier occurrence', () => {
    expect(ilWallTimeToIso('2026-03-27', '02:30')).toBe('2026-03-27T03:30:00+03:00');
    expect(ilWallTimeToIso('2026-10-25', '01:30')).toBe('2026-10-25T01:30:00+03:00');
  });

  it('keeps seconds and milliseconds: 2026-10-25T01:30:00.123 stays .123', () => {
    expect(ilWallTimeToIso('2026-10-25', '01:30:00.123')).toBe('2026-10-25T01:30:00.123+03:00');
    expect(ilWallTimeToIso('2026-03-27', '02:30:45')).toBe('2026-03-27T03:30:45+03:00');
    expect(ilWallTimeToIso('2026-10-25', '01:30:00.5')).toBe('2026-10-25T01:30:00.5+03:00');
    // No fraction in, none out.
    expect(ilWallTimeToIso('2026-10-25', '01:30:00')).toBe('2026-10-25T01:30:00+03:00');
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
    expect(() => ilWallTimeToIso('2026-03-27', '10:00Z')).toThrow(RangeError);
    expect(() => ilWallTimeToIso('2026-03-27', 'noon')).toThrow(/not an Israel wall-clock/);
  });

  it('with no time it stays the plain date, whatever it contains (the date-only contract is untouched)', () => {
    expect(ilWallTimeToIso('2026-03-27', '')).toBe('2026-03-27');
    expect(ilWallTimeToIso('not-a-date', '')).toBe('not-a-date');
  });
});

// ── DST wall-clock contract ─────────────────────────────────────────────────────────────────────────
// wallClockToDate and ilWallTimeToIso resolve a wall time across a DST switch by ONE policy, for every IANA
// zone and whatever the zone of the machine running them:
//
//   overlap (the wall time happens twice)  ->  the EARLIER occurrence
//   gap     (the wall time never happens)  ->  moved FORWARD by the size of the jump
//
// That is ECMAScript Date, Temporal's "compatible" and RFC 5545 §3.3.5. It is NOT PostgreSQL's
// `AT TIME ZONE`, which takes the LATER occurrence of an overlap (docs, B.2 "Handling of Invalid or Ambiguous
// Timestamps"; measured on the linked DB 13.10.2026: timestamp '2026-10-25 01:30' AT TIME ZONE
// 'Asia/Jerusalem' = 23:30Z); the gap agrees with PostgreSQL. Do not hand such a time to SQL.
//
//   Israel 2026: 27.3 02:00 -> 03:00 (02:00-02:59 never happens: the GAP);
//                25.10 02:00 -> 01:00 (01:00-01:59 happens twice, +03:00 then +02:00: the OVERLAP).
//   Israel 2027: 26.3 02:00 -> 03:00;  31.10 02:00 -> 01:00.
//
// How the host zone is varied: vitest.config.mts pins TZ for the whole run, so `TZ=UTC npm test` would change
// nothing, and assigning process.env.TZ inside a test only reaches what happens to re-read it. 'host zone
// matrix' therefore bundles the real module and runs it in a fresh Node process per host zone
// (src/test/host-zone.ts).
describe('DST wall-clock contract — overlap = earlier, gap = forward', () => {
  const IL = 'Asia/Jerusalem';
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('Israel 2026 autumn overlap: every wall time in 01:00-01:59 is its FIRST occurrence (+03:00)', () => {
    expect(iso(wallClockToDate('2026-10-25T01:00', IL))).toBe('2026-10-24T22:00:00.000Z');
    expect(iso(wallClockToDate('2026-10-25T01:30', IL))).toBe('2026-10-24T22:30:00.000Z');
    expect(iso(wallClockToDate('2026-10-25T01:59', IL))).toBe('2026-10-24T22:59:00.000Z');
    expect(ilWallTimeToIso('2026-10-25', '01:30')).toBe('2026-10-25T01:30:00+03:00');
  });

  it('Israel 2026 spring gap: every wall time in 02:00-02:59 moves FORWARD one hour', () => {
    expect(iso(wallClockToDate('2026-03-27T02:00', IL))).toBe('2026-03-27T00:00:00.000Z');
    expect(iso(wallClockToDate('2026-03-27T02:30', IL))).toBe('2026-03-27T00:30:00.000Z');
    expect(iso(wallClockToDate('2026-03-27T02:59', IL))).toBe('2026-03-27T00:59:00.000Z');
    expect(ilWallTimeToIso('2026-03-27', '02:30')).toBe('2026-03-27T03:30:00+03:00');
    // Seconds ride along.
    expect(iso(wallClockToDate('2026-03-27T02:30:45', IL))).toBe('2026-03-27T00:30:45.000Z');
    // What the user sees after saving an event typed as 02:30 on that day: the MOVED time, not the one typed.
    expect(ilTimeInputValue(ilWallTimeToIso('2026-03-27', '02:30'))).toBe('03:30');
  });

  it('Israel 2027 follows the same policy on its own switch days', () => {
    // 2027-10-31 02:00 -> 01:00 (switch at 2027-10-30T23:00Z); 2027-03-26 02:00 -> 03:00 (at 00:00Z).
    expect(iso(wallClockToDate('2027-10-31T01:00', IL))).toBe('2027-10-30T22:00:00.000Z');
    expect(iso(wallClockToDate('2027-10-31T01:30', IL))).toBe('2027-10-30T22:30:00.000Z');
    expect(iso(wallClockToDate('2027-10-31T01:59', IL))).toBe('2027-10-30T22:59:00.000Z');
    expect(iso(wallClockToDate('2027-03-26T02:00', IL))).toBe('2027-03-26T00:00:00.000Z');
    expect(iso(wallClockToDate('2027-03-26T02:30', IL))).toBe('2027-03-26T00:30:00.000Z');
    expect(iso(wallClockToDate('2027-03-26T02:59', IL))).toBe('2027-03-26T00:59:00.000Z');
    expect(ilWallTimeToIso('2027-10-31', '01:30')).toBe('2027-10-31T01:30:00+03:00');
    expect(ilWallTimeToIso('2027-03-26', '02:30')).toBe('2027-03-26T03:30:00+03:00');
  });

  it('wall times on a switch day outside the gap and the overlap are plain single instants', () => {
    expect(iso(wallClockToDate('2026-10-25T00:30', IL))).toBe('2026-10-24T21:30:00.000Z');
    expect(iso(wallClockToDate('2026-10-25T02:00', IL))).toBe('2026-10-25T00:00:00.000Z'); // first minute after the overlap
    expect(iso(wallClockToDate('2026-10-25T02:30', IL))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(wallClockToDate('2026-03-27T01:59', IL))).toBe('2026-03-26T23:59:00.000Z'); // last minute before the gap
    expect(iso(wallClockToDate('2026-03-27T03:00', IL))).toBe('2026-03-27T00:00:00.000Z'); // first minute after it
    expect(iso(wallClockToDate('2026-03-27T03:30', IL))).toBe('2026-03-27T00:30:00.000Z');
  });

  it('cannot tell the two occurrences apart afterwards: both read back as 01:30', () => {
    // The second occurrence can never be asked for, and a stored overlap time shows no sign of which one it is.
    expect(ilTimeInputValue('2026-10-24T22:30:00.000Z')).toBe('01:30');
    expect(ilTimeInputValue('2026-10-24T23:30:00.000Z')).toBe('01:30');
  });

  it('equals an independent, Intl-only oracle for every minute around both Israeli switches of 2026 (overlap: earlier, gap: forward)', () => {
    const wallFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: IL,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const wallOf = (ms: number): string => {
      const p = Object.fromEntries(wallFmt.formatToParts(ms).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    };
    const two = (n: number) => String(n).padStart(2, '0');
    const HOUR = 3_600_000;
    // Israel has exactly two offsets: +02:00 (IST) and +03:00 (IDT). The oracle reads the wall text as if it were
    // UTC, keeps the candidate instants whose Israel wall clock really reads that text (Intl with an explicit
    // zone — no host zone), and takes the earliest; with none (the gap) it takes the pre-gap +02:00.
    const oracle = (wall: string): { ms: number; candidates: number } => {
      const asUtc = Date.parse(`${wall}:00Z`);
      const real = [asUtc - 3 * HOUR, asUtc - 2 * HOUR].filter((ms) => wallOf(ms) === wall);
      return real.length > 0 ? { ms: Math.min(...real), candidates: real.length } : { ms: asUtc - 2 * HOUR, candidates: 0 };
    };

    let overlapMinutes = 0;
    let gapMinutes = 0;
    // 26-28.3.2026 and 24-26.10.2026, every minute.
    for (const [year, month, firstDay] of [
      [2026, 2, 26],
      [2026, 9, 24],
    ] as const) {
      for (let k = 0; k < 3 * 24 * 60; k += 1) {
        const w = new Date(Date.UTC(year, month, firstDay, 0, k));
        const wall = `${w.getUTCFullYear()}-${two(w.getUTCMonth() + 1)}-${two(w.getUTCDate())}T${two(w.getUTCHours())}:${two(w.getUTCMinutes())}`;
        const expected = oracle(wall);
        if (expected.candidates === 2) overlapMinutes += 1;
        if (expected.candidates === 0) gapMinutes += 1;
        expect(wallClockToDate(wall, IL)?.getTime(), wall).toBe(expected.ms);
      }
    }
    // The oracle saw the real thing: one repeated hour and one skipped hour.
    expect(overlapMinutes).toBe(60);
    expect(gapMinutes).toBe(60);
  });

  // Any IANA zone, not only Israel — and not only 60-minute jumps. The switch instants below are written out
  // (found once by walking Intl.DateTimeFormat's offset minute by minute) so the test needs no library to know
  // where a switch is; the oracle then walks the minutes around each one, asks Intl what the zone's wall clock
  // reads at every instant, and derives from that alone what every wall minute must resolve to. Lord_Howe jumps
  // 30 minutes, Chatham sits on :45 offsets, Casablanca runs its DST backwards for Ramadan.
  // [switch instant (UTC), wall-clock change in minutes: + is a gap, - is an overlap]
  const SWITCHES: Record<string, Array<[utc: string, change: number]>> = {
    'Asia/Jerusalem': [
      ['2026-03-27T00:00:00Z', 60],
      ['2026-10-24T23:00:00Z', -60],
      ['2027-03-26T00:00:00Z', 60],
      ['2027-10-30T23:00:00Z', -60],
    ],
    'America/New_York': [
      ['2026-03-08T07:00:00Z', 60],
      ['2026-11-01T06:00:00Z', -60],
    ],
    'Europe/Berlin': [
      ['2026-03-29T01:00:00Z', 60],
      ['2026-10-25T01:00:00Z', -60],
    ],
    'Europe/Athens': [
      ['2026-03-29T01:00:00Z', 60],
      ['2026-10-25T01:00:00Z', -60],
    ],
    'Australia/Lord_Howe': [
      ['2026-04-04T15:00:00Z', -30],
      ['2026-10-03T15:30:00Z', 30],
    ],
    'Pacific/Chatham': [
      ['2026-04-04T14:00:00Z', -60],
      ['2026-09-26T14:00:00Z', 60],
    ],
    'Africa/Casablanca': [
      ['2026-02-15T02:00:00Z', -60],
      ['2026-03-22T02:00:00Z', 60],
      ['2026-09-20T01:00:00Z', -60],
    ],
  };

  function oracleWindow(zone: string, startMs: number, endMs: number) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const wallOf = (ms: number): number => {
      const p = Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    };
    const MIN = 60_000;
    const expected = new Map<number, number>(); // wall minute (as if UTC) -> the instant it must resolve to
    let overlapMinutes = 0;
    let gapMinutes = 0;
    let prevWall = Number.NaN;
    let prevInstant = Number.NaN;
    for (let t = startMs; t <= endMs; t += MIN) {
      const w = wallOf(t);
      if (expected.has(w)) overlapMinutes += 1; // seen before: the second occurrence — the first stays
      else expected.set(w, t);
      if (!Number.isNaN(prevWall) && w - prevWall > MIN) {
        // A gap: the skipped wall minutes resolve with the offset from before it, i.e. forward by the jump.
        const offsetBefore = prevWall - prevInstant;
        for (let g = prevWall + MIN; g < w; g += MIN) {
          expected.set(g, g - offsetBefore);
          gapMinutes += 1;
        }
      }
      prevWall = w;
      prevInstant = t;
    }
    return { expected, overlapMinutes, gapMinutes };
  }

  it.each(Object.keys(SWITCHES))('%s: every wall minute around every listed switch equals an Intl-only oracle', (zone) => {
    const mismatches: string[] = [];
    for (const [utc, change] of SWITCHES[zone]) {
      const at = Date.parse(utc);
      const { expected, overlapMinutes, gapMinutes } = oracleWindow(zone, at - 3 * 3_600_000, at + 3 * 3_600_000);
      // The table is checked against Intl too: a forward jump of `change` minutes is a gap that long, a backward
      // one an overlap that long. A wrong switch instant or size in the table fails here, not silently.
      if (change > 0) expect(gapMinutes, `${zone} gap at ${utc}`).toBe(change);
      else expect(overlapMinutes, `${zone} overlap at ${utc}`).toBe(-change);
      for (const [wall, instant] of expected) {
        const text = new Date(wall).toISOString().slice(0, 16);
        const got = wallClockToDate(text, zone)?.getTime();
        if (got !== instant) mismatches.push(`${zone} ${text}: got ${got}, want ${instant}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('other zones, by hand: New York and Berlin (60 minutes), Lord_Howe (30 minutes)', () => {
    // New York 2026: 8.3 02:00 -> 03:00 (gap); 1.11 02:00 -> 01:00 (overlap, EDT -04:00 first).
    expect(iso(wallClockToDate('2026-11-01T01:30', 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z');
    expect(iso(wallClockToDate('2026-03-08T02:30', 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z');
    // Berlin 2026: 29.3 02:00 -> 03:00 (gap); 25.10 03:00 -> 02:00 (overlap, CEST +02:00 first).
    expect(iso(wallClockToDate('2026-10-25T02:30', 'Europe/Berlin'))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(wallClockToDate('2026-03-29T02:30', 'Europe/Berlin'))).toBe('2026-03-29T01:30:00.000Z');
    // Lord_Howe 2026: 5.4 02:00 -> 01:30 (a 30-minute overlap, +11:00 first); 4.10 02:00 -> 02:30 (a 30-minute gap).
    expect(iso(wallClockToDate('2026-04-05T01:45', 'Australia/Lord_Howe'))).toBe('2026-04-04T14:45:00.000Z');
    expect(iso(wallClockToDate('2026-04-05T01:30', 'Australia/Lord_Howe'))).toBe('2026-04-04T14:30:00.000Z');
    expect(iso(wallClockToDate('2026-04-05T02:00', 'Australia/Lord_Howe'))).toBe('2026-04-04T15:30:00.000Z'); // after the overlap: +10:30
    expect(iso(wallClockToDate('2026-10-04T02:15', 'Australia/Lord_Howe'))).toBe('2026-10-03T15:45:00.000Z'); // forward 30 min, not 60
    expect(iso(wallClockToDate('2026-10-04T02:30', 'Australia/Lord_Howe'))).toBe('2026-10-03T15:30:00.000Z'); // first minute after the gap
    expect(iso(wallClockToDate('2026-10-04T01:59', 'Australia/Lord_Howe'))).toBe('2026-10-03T15:29:00.000Z'); // last minute before it
  });
});

// ── host zone matrix ────────────────────────────────────────────────────────────────────────────────
// The production resolver, bundled and run in a FRESH Node process per host zone (the host zone is decided at
// process start, as on a deployment on another machine). Same inputs, same instants, on every host — including
// the hosts whose own DST gap swallows an ordinary Israeli wall time (Athens, Cairo, Lord_Howe), which is where
// a resolver built on the host's native Date was an hour off.
describe('host zone matrix — the result does not depend on the zone of the machine', () => {
  const IL = 'Asia/Jerusalem';
  let runner: HostRunner;

  beforeAll(() => {
    runner = createHostRunner(`
      import { ilWallTimeToIso, wallClockToDate } from '@/lib/data/event-date';
      const { cases, ilCases } = JSON.parse(process.argv[2]);
      console.log(JSON.stringify({
        host: Intl.DateTimeFormat().resolvedOptions().timeZone,
        instants: cases.map(([wall, zone]) => wallClockToDate(wall, zone)?.toISOString() ?? null),
        il: ilCases.map(([date, time]) => {
          try { return ilWallTimeToIso(date, time); } catch (e) { return 'ERR:' + e.name; }
        }),
      }));
    `);
  }, 30_000);
  afterAll(() => runner.dispose());

  // [wall, zone, expected instant] — written out by hand.
  const CASES: Array<[wall: string, zone: string, instant: string | null]> = [
    ['2026-10-25T01:00', IL, '2026-10-24T22:00:00.000Z'], // Israel 2026 overlap: earlier
    ['2026-10-25T01:30', IL, '2026-10-24T22:30:00.000Z'],
    ['2026-10-25T01:59', IL, '2026-10-24T22:59:00.000Z'],
    ['2026-10-25T01:30:00.123', IL, '2026-10-24T22:30:00.123Z'], // milliseconds ride along
    ['2026-03-27T02:00', IL, '2026-03-27T00:00:00.000Z'], // Israel 2026 gap: forward
    ['2026-03-27T02:30', IL, '2026-03-27T00:30:00.000Z'],
    ['2026-03-27T02:59', IL, '2026-03-27T00:59:00.000Z'],
    ['2027-10-31T01:30', IL, '2027-10-30T22:30:00.000Z'], // Israel 2027
    ['2027-03-26T02:30', IL, '2027-03-26T00:30:00.000Z'],
    ['2026-10-25T00:30', IL, '2026-10-24T21:30:00.000Z'], // ordinary, on a switch day
    ['2026-10-25T02:30', IL, '2026-10-25T00:30:00.000Z'],
    ['2026-03-27T01:30', IL, '2026-03-26T23:30:00.000Z'],
    ['2026-03-27T03:30', IL, '2026-03-27T00:30:00.000Z'],
    ['2026-03-29T03:30', IL, '2026-03-29T00:30:00.000Z'], // inside Athens' / Helsinki's own gap as a HOST (was 01:30Z there)
    ['2026-04-24T00:30', IL, '2026-04-23T21:30:00.000Z'], // inside Cairo's own gap as a host
    ['2026-10-04T02:15', IL, '2026-10-03T23:15:00.000Z'], // inside Lord_Howe's own gap as a host
    ['2026-01-15T09:30', IL, '2026-01-15T07:30:00.000Z'],
    ['2026-07-15T09:30', IL, '2026-07-15T06:30:00.000Z'],
    ['2026-11-01T01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'], // overlap: EDT (-4) first
    ['2026-03-08T02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'], // gap: -> 03:30 EDT
    ['2026-10-25T02:30', 'Europe/Berlin', '2026-10-25T00:30:00.000Z'], // overlap: CEST (+2) first
    ['2026-03-29T02:30', 'Europe/Berlin', '2026-03-29T01:30:00.000Z'], // gap: -> 03:30 CEST
    ['2026-04-05T01:45', 'Australia/Lord_Howe', '2026-04-04T14:45:00.000Z'], // overlap, 30 min: +11:00 first
    ['2026-10-04T02:15', 'Australia/Lord_Howe', '2026-10-03T15:45:00.000Z'], // gap, 30 min: forward 30
    ['2026-02-30T10:00', IL, null], // invalid stays invalid on every host
    ['2026-10-25T01:30Z', IL, null],
    ['2026-10-25T01:30', 'Not/AZone', null],
  ];
  const IL_CASES: Array<[date: string, time: string, text: string]> = [
    ['2026-10-25', '01:30', '2026-10-25T01:30:00+03:00'],
    ['2026-03-27', '02:30', '2026-03-27T03:30:00+03:00'],
    ['2027-10-31', '01:30', '2027-10-31T01:30:00+03:00'],
    ['2027-03-26', '02:30', '2027-03-26T03:30:00+03:00'],
    ['2026-10-25', '01:30:00.123', '2026-10-25T01:30:00.123+03:00'],
    ['2026-03-27', '02:30:45', '2026-03-27T03:30:45+03:00'],
    ['2026-01-15', '09:30', '2026-01-15T09:30:00+02:00'],
    ['2026-07-15', '09:30', '2026-07-15T09:30:00+03:00'],
    ['2026-03-27', '', '2026-03-27'],
    ['not-a-date', '10:00', 'ERR:RangeError'],
  ];

  it.each(HOST_ZONES)('host %s: every case gives the same instant', (host) => {
    const out = runner.run<{ host: string; instants: Array<string | null>; il: string[] }>(host, {
      cases: CASES.map(([wall, zone]) => [wall, zone]),
      ilCases: IL_CASES.map(([date, time]) => [date, time]),
    });
    // The switch took effect: the child really ran under the requested host zone.
    expect(out.host).toBe(host);
    const mismatches: string[] = [];
    CASES.forEach(([wall, zone, instant], i) => {
      if (out.instants[i] !== instant) mismatches.push(`${zone} ${wall}: got ${out.instants[i]}, want ${instant}`);
    });
    IL_CASES.forEach(([date, time, text], i) => {
      if (out.il[i] !== text) mismatches.push(`ilWallTimeToIso(${date}, ${time}): got ${out.il[i]}, want ${text}`);
    });
    expect(mismatches).toEqual([]);
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
