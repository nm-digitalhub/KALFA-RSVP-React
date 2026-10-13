import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHostRunner, HOST_ZONES, type HostRunner } from '@/test/host-zone';

// expandRecurrence / parseRRuleString turn wall-clock rules ("every day at 01:30", "UNTIL=20261025") into
// instants in the DISPLAY zone. Every such conversion goes through the shared resolver
// (wallClockToDate, data/event-date.ts): an overlap takes the earlier occurrence, a gap moves forward, and the
// zone of the machine running the code never enters. These tests run the REAL module in a fresh Node process
// per host zone (src/test/host-zone.ts) — vitest.config.mts pins TZ for the whole run, so a host zone cannot be
// varied from inside a test — and compare against expectations written out by hand or captured from the
// implementation that came before (see REGRESSION).
//
// Israel 2026: 27.3 02:00 -> 03:00 (02:00-02:59 never happens: the GAP; it resolves forward to 03:xx +03:00)
//              25.10 02:00 -> 01:00 (01:00-01:59 happens twice: the OVERLAP; it resolves to the first, +03:00)

interface Series {
  id: string;
  zone: string;
  start: string;
  durMin: number;
  rule: string;
  range: [string, string];
}

/** [rule, zone, expected `until` ISO, or 'ERR:<error name>'] */
type UntilCase = [rule: string, zone: string, expected: string];

const IL = 'Asia/Jerusalem';
const NY = 'America/New_York';
const BERLIN = 'Europe/Berlin';
const LORD_HOWE = 'Australia/Lord_Howe';

// Series whose wall times sit in an overlap or a gap. Expected starts are worked out by hand from the zone's
// rules: the series keeps its DTSTART wall time every period, so 01:30 stays 01:30 across the switch while the
// UTC instant moves by an hour (or by 30 minutes in Lord_Howe).
const DST_SERIES: Array<Series & { starts: string[] }> = [
  {
    // 23.10 01:30 IDT, 24.10 01:30 IDT, 25.10 01:30 = overlap -> FIRST (+03:00), then 01:30 IST (+02:00).
    id: 'il-overlap-daily-0130',
    zone: IL,
    start: '2026-10-22T22:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=6',
    range: ['2026-10-22T00:00:00.000Z', '2026-10-29T00:00:00.000Z'],
    starts: [
      '2026-10-22T22:30:00.000Z',
      '2026-10-23T22:30:00.000Z',
      '2026-10-24T22:30:00.000Z', // 25.10 01:30 — the first occurrence
      '2026-10-25T23:30:00.000Z',
      '2026-10-26T23:30:00.000Z',
      '2026-10-27T23:30:00.000Z',
    ],
  },
  {
    // 26.3 02:30 IST, 27.3 02:30 = gap -> 03:30 IDT, then 02:30 IDT.
    id: 'il-gap-daily-0230',
    zone: IL,
    start: '2026-03-25T00:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=6',
    range: ['2026-03-25T00:00:00.000Z', '2026-03-31T00:00:00.000Z'],
    starts: [
      '2026-03-25T00:30:00.000Z',
      '2026-03-26T00:30:00.000Z',
      '2026-03-27T00:30:00.000Z', // 27.3 02:30 does not exist -> 03:30 IDT
      '2026-03-27T23:30:00.000Z',
      '2026-03-28T23:30:00.000Z',
      '2026-03-29T23:30:00.000Z',
    ],
  },
  {
    // Sundays at 01:30: 25.10 is a Sunday.
    id: 'il-overlap-weekly-su-0130',
    zone: IL,
    start: '2026-10-03T22:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=WEEKLY;BYDAY=SU;COUNT=6',
    range: ['2026-10-01T00:00:00.000Z', '2026-11-10T00:00:00.000Z'],
    starts: [
      '2026-10-03T22:30:00.000Z',
      '2026-10-10T22:30:00.000Z',
      '2026-10-17T22:30:00.000Z',
      '2026-10-24T22:30:00.000Z', // 25.10 01:30 — the first occurrence
      '2026-10-31T23:30:00.000Z',
      '2026-11-07T23:30:00.000Z',
    ],
  },
  {
    id: 'il-overlap-monthly-25-0130',
    zone: IL,
    start: '2026-09-24T22:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=MONTHLY;BYMONTHDAY=25;COUNT=4',
    range: ['2026-09-01T00:00:00.000Z', '2027-01-05T00:00:00.000Z'],
    starts: [
      '2026-09-24T22:30:00.000Z',
      '2026-10-24T22:30:00.000Z', // 25.10 01:30 — the first occurrence
      '2026-11-24T23:30:00.000Z',
      '2026-12-24T23:30:00.000Z',
    ],
  },
  {
    id: 'il-gap-monthly-27-0230',
    zone: IL,
    start: '2026-02-27T00:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=MONTHLY;BYMONTHDAY=27;COUNT=4',
    range: ['2026-02-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
    starts: [
      '2026-02-27T00:30:00.000Z',
      '2026-03-27T00:30:00.000Z', // 27.3 02:30 does not exist -> 03:30 IDT
      '2026-04-26T23:30:00.000Z',
      '2026-05-26T23:30:00.000Z',
    ],
  },
  {
    // 25.10 in 2025 and 2027 is an ordinary day (the switches are 26.10.2025 and 31.10.2027); in 2026 it is the overlap.
    id: 'il-overlap-yearly-1025-0130',
    zone: IL,
    start: '2025-10-24T22:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=YEARLY;COUNT=3',
    range: ['2025-10-01T00:00:00.000Z', '2027-12-01T00:00:00.000Z'],
    starts: ['2025-10-24T22:30:00.000Z', '2026-10-24T22:30:00.000Z', '2027-10-24T22:30:00.000Z'],
  },
  {
    // An ordinary Israeli time that is inside Athens' own spring gap as a HOST (29.3 03:00-03:59): the old
    // date-fns setters gave 01:30Z there instead of 00:30Z.
    id: 'il-ordinary-daily-0330-across-athens-gap',
    zone: IL,
    start: '2026-03-27T00:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=4',
    range: ['2026-03-27T00:00:00.000Z', '2026-04-01T00:00:00.000Z'],
    starts: ['2026-03-27T00:30:00.000Z', '2026-03-28T00:30:00.000Z', '2026-03-29T00:30:00.000Z', '2026-03-30T00:30:00.000Z'],
  },
  {
    // New York: 1.11 01:30 happens twice (EDT -04:00 first, then EST -05:00).
    id: 'ny-overlap-daily-0130',
    zone: NY,
    start: '2026-10-31T05:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=3',
    range: ['2026-10-30T00:00:00.000Z', '2026-11-05T00:00:00.000Z'],
    starts: ['2026-10-31T05:30:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'],
  },
  {
    // Berlin: 29.3 02:30 does not exist (02:00 CET -> 03:00 CEST) -> 03:30 CEST.
    id: 'berlin-gap-daily-0230',
    zone: BERLIN,
    start: '2026-03-28T01:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=3',
    range: ['2026-03-28T00:00:00.000Z', '2026-04-02T00:00:00.000Z'],
    starts: ['2026-03-28T01:30:00.000Z', '2026-03-29T01:30:00.000Z', '2026-03-30T00:30:00.000Z'],
  },
  {
    // Lord_Howe jumps 30 minutes, not 60: 4.10 02:00 -> 02:30, so 02:15 moves forward to 02:45 (+11:00).
    id: 'lord-howe-gap-daily-0215',
    zone: LORD_HOWE,
    start: '2026-10-02T15:45:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=3',
    range: ['2026-10-02T00:00:00.000Z', '2026-10-07T00:00:00.000Z'],
    starts: ['2026-10-02T15:45:00.000Z', '2026-10-03T15:45:00.000Z', '2026-10-04T15:15:00.000Z'],
  },
  {
    // Lord_Howe 5.4 02:00 -> 01:30: 01:45 happens twice (+11:00 first, then +10:30).
    id: 'lord-howe-overlap-daily-0145',
    zone: LORD_HOWE,
    start: '2026-04-03T14:45:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=3',
    range: ['2026-04-03T00:00:00.000Z', '2026-04-08T00:00:00.000Z'],
    starts: ['2026-04-03T14:45:00.000Z', '2026-04-04T14:45:00.000Z', '2026-04-05T15:15:00.000Z'],
  },
  {
    // UNTIL is wall time in the display zone and inclusive: 25.10 01:30 (first occurrence, 22:30Z) is the last one.
    id: 'until-wall-time-inside-overlap-is-inclusive',
    zone: IL,
    start: '2026-10-22T22:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;UNTIL=20261025T013000',
    range: ['2026-10-22T00:00:00.000Z', '2026-10-30T00:00:00.000Z'],
    starts: ['2026-10-22T22:30:00.000Z', '2026-10-23T22:30:00.000Z', '2026-10-24T22:30:00.000Z'],
  },
  {
    id: 'until-one-second-before-the-overlap-time-excludes-it',
    zone: IL,
    start: '2026-10-22T22:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;UNTIL=20261025T012959',
    range: ['2026-10-22T00:00:00.000Z', '2026-10-30T00:00:00.000Z'],
    starts: ['2026-10-22T22:30:00.000Z', '2026-10-23T22:30:00.000Z'],
  },
  {
    // A date-only UNTIL means 23:59:59 of that day, inclusive: 25.10 23:30 IST (21:30Z) is in, 26.10 23:30 is out.
    id: 'until-date-only-is-inclusive-to-end-of-day',
    zone: IL,
    start: '2026-10-23T20:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;UNTIL=20261025',
    range: ['2026-10-23T00:00:00.000Z', '2026-10-30T00:00:00.000Z'],
    starts: ['2026-10-23T20:30:00.000Z', '2026-10-24T20:30:00.000Z', '2026-10-25T21:30:00.000Z'],
  },
  {
    // UNTIL…Z is an absolute instant: no zone is involved. 22:29:59Z is one second before the 24.10 22:30Z occurrence.
    id: 'until-z-is-absolute',
    zone: IL,
    start: '2026-10-22T22:30:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;UNTIL=20261024T222959Z',
    range: ['2026-10-22T00:00:00.000Z', '2026-10-30T00:00:00.000Z'],
    starts: ['2026-10-22T22:30:00.000Z', '2026-10-23T22:30:00.000Z'],
  },
];

const UNTILS: UntilCase[] = [
  ['FREQ=DAILY;UNTIL=20261025', IL, '2026-10-25T21:59:59.000Z'], // 23:59:59 IST, after the overlap
  ['FREQ=DAILY;UNTIL=20261025T013000', IL, '2026-10-24T22:30:00.000Z'], // inside the overlap -> the first occurrence
  ['FREQ=DAILY;UNTIL=20261025T013000Z', IL, '2026-10-25T01:30:00.000Z'], // absolute
  ['FREQ=DAILY;until=20261025t013000z', IL, '2026-10-25T01:30:00.000Z'], // RFC 5545 folds case
  ['FREQ=DAILY;UNTIL=20260327T023000', IL, '2026-03-27T00:30:00.000Z'], // inside the gap -> forward
  ['FREQ=DAILY;UNTIL=20260327', IL, '2026-03-27T20:59:59.000Z'], // 23:59:59 IDT
  ['FREQ=DAILY;UNTIL=20261101T013000', NY, '2026-11-01T05:30:00.000Z'],
  ['FREQ=DAILY;UNTIL=20260329T023000', BERLIN, '2026-03-29T01:30:00.000Z'],
  ['FREQ=DAILY;UNTIL=20261004T021500', LORD_HOWE, '2026-10-03T15:45:00.000Z'], // 30-minute gap
  ['FREQ=DAILY;UNTIL=garbage', IL, 'ERR:EventCalendarRecurrenceError'],
  ['FREQ=DAILY;UNTIL=20260230', IL, 'ERR:EventCalendarRecurrenceError'], // 30 February
  ['FREQ=DAILY;UNTIL=20261301T000000', IL, 'ERR:EventCalendarRecurrenceError'], // month 13
  ['FREQ=DAILY;UNTIL=20261301T000000Z', IL, 'ERR:EventCalendarRecurrenceError'],
  ['FREQ=DAILY;UNTIL=20261025T240000', IL, 'ERR:EventCalendarRecurrenceError'], // hour 24 is not a wall-clock time
  ['FREQ=DAILY;UNTIL=20261025', 'Not/AZone', 'ERR:EventCalendarRecurrenceError'], // no fallback to the machine's zone
];

// Ordinary series (no wall time inside an overlap or a gap) whose occurrences were CAPTURED from the implementation
// that came before this change (git b6fb1196, which built every wall time with date-fns/@date-fns/tz on a host
// running TZ=Asia/Jerusalem — the production setup), on 2026-10-13. The new code must reproduce them
// timestamp for timestamp, on every host zone. They include a month-end rule (31st), a leap-day rule, a date-only
// UNTIL, a three-day span across the spring switch, and New York / Berlin series across their own switches.
const REGRESSION: Array<{
  id: string;
  zone: string;
  start: string;
  durMin: number;
  rule: string;
  range: [string, string];
  occurrences: Array<[start: string, end: string]>;
}> = [
  {
    id: 'weekly-mo-we-fr-0900',
    zone: 'Asia/Jerusalem',
    start: '2026-01-05T07:00:00.000Z',
    durMin: 60,
    rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    range: ['2026-01-05T00:00:00.000Z', '2026-02-02T00:00:00.000Z'],
    occurrences: [
      ['2026-01-05T07:00:00.000Z', '2026-01-05T08:00:00.000Z'],
      ['2026-01-07T07:00:00.000Z', '2026-01-07T08:00:00.000Z'],
      ['2026-01-09T07:00:00.000Z', '2026-01-09T08:00:00.000Z'],
      ['2026-01-12T07:00:00.000Z', '2026-01-12T08:00:00.000Z'],
      ['2026-01-14T07:00:00.000Z', '2026-01-14T08:00:00.000Z'],
      ['2026-01-16T07:00:00.000Z', '2026-01-16T08:00:00.000Z'],
      ['2026-01-19T07:00:00.000Z', '2026-01-19T08:00:00.000Z'],
      ['2026-01-21T07:00:00.000Z', '2026-01-21T08:00:00.000Z'],
      ['2026-01-23T07:00:00.000Z', '2026-01-23T08:00:00.000Z'],
      ['2026-01-26T07:00:00.000Z', '2026-01-26T08:00:00.000Z'],
      ['2026-01-28T07:00:00.000Z', '2026-01-28T08:00:00.000Z'],
      ['2026-01-30T07:00:00.000Z', '2026-01-30T08:00:00.000Z'],
    ],
  },
  {
    id: 'daily-every-3-count-6-1730',
    zone: 'Asia/Jerusalem',
    start: '2026-07-01T14:30:00.000Z',
    durMin: 90,
    rule: 'FREQ=DAILY;INTERVAL=3;COUNT=6',
    range: ['2026-06-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    occurrences: [
      ['2026-07-01T14:30:00.000Z', '2026-07-01T16:00:00.000Z'],
      ['2026-07-04T14:30:00.000Z', '2026-07-04T16:00:00.000Z'],
      ['2026-07-07T14:30:00.000Z', '2026-07-07T16:00:00.000Z'],
      ['2026-07-10T14:30:00.000Z', '2026-07-10T16:00:00.000Z'],
      ['2026-07-13T14:30:00.000Z', '2026-07-13T16:00:00.000Z'],
      ['2026-07-16T14:30:00.000Z', '2026-07-16T16:00:00.000Z'],
    ],
  },
  {
    id: 'monthly-2nd-tuesday-2000',
    zone: 'Asia/Jerusalem',
    start: '2026-06-09T17:00:00.000Z',
    durMin: 60,
    rule: 'FREQ=MONTHLY;BYDAY=2TU',
    range: ['2026-06-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    occurrences: [
      ['2026-06-09T17:00:00.000Z', '2026-06-09T18:00:00.000Z'],
      ['2026-07-14T17:00:00.000Z', '2026-07-14T18:00:00.000Z'],
      ['2026-08-11T17:00:00.000Z', '2026-08-11T18:00:00.000Z'],
      ['2026-09-08T17:00:00.000Z', '2026-09-08T18:00:00.000Z'],
      ['2026-10-13T17:00:00.000Z', '2026-10-13T18:00:00.000Z'],
      ['2026-11-10T18:00:00.000Z', '2026-11-10T19:00:00.000Z'],
      ['2026-12-08T18:00:00.000Z', '2026-12-08T19:00:00.000Z'],
    ],
  },
  {
    id: 'monthly-31st-1200',
    zone: 'Asia/Jerusalem',
    start: '2026-01-31T10:00:00.000Z',
    durMin: 60,
    rule: 'FREQ=MONTHLY;BYMONTHDAY=31',
    range: ['2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    occurrences: [
      ['2026-01-31T10:00:00.000Z', '2026-01-31T11:00:00.000Z'],
      ['2026-03-31T09:00:00.000Z', '2026-03-31T10:00:00.000Z'],
      ['2026-05-31T09:00:00.000Z', '2026-05-31T10:00:00.000Z'],
      ['2026-07-31T09:00:00.000Z', '2026-07-31T10:00:00.000Z'],
      ['2026-08-31T09:00:00.000Z', '2026-08-31T10:00:00.000Z'],
      ['2026-10-31T10:00:00.000Z', '2026-10-31T11:00:00.000Z'],
      ['2026-12-31T10:00:00.000Z', '2026-12-31T11:00:00.000Z'],
    ],
  },
  {
    id: 'yearly-feb-29-1200',
    zone: 'Asia/Jerusalem',
    start: '2024-02-29T10:00:00.000Z',
    durMin: 60,
    rule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
    range: ['2024-01-01T00:00:00.000Z', '2033-01-01T00:00:00.000Z'],
    occurrences: [
      ['2024-02-29T10:00:00.000Z', '2024-02-29T11:00:00.000Z'],
      ['2028-02-29T10:00:00.000Z', '2028-02-29T11:00:00.000Z'],
      ['2032-02-29T10:00:00.000Z', '2032-02-29T11:00:00.000Z'],
    ],
  },
  {
    id: 'daily-until-date-only',
    zone: 'Asia/Jerusalem',
    start: '2026-08-01T05:00:00.000Z',
    durMin: 30,
    rule: 'FREQ=DAILY;UNTIL=20260805',
    range: ['2026-07-30T00:00:00.000Z', '2026-08-20T00:00:00.000Z'],
    occurrences: [
      ['2026-08-01T05:00:00.000Z', '2026-08-01T05:30:00.000Z'],
      ['2026-08-02T05:00:00.000Z', '2026-08-02T05:30:00.000Z'],
      ['2026-08-03T05:00:00.000Z', '2026-08-03T05:30:00.000Z'],
      ['2026-08-04T05:00:00.000Z', '2026-08-04T05:30:00.000Z'],
      ['2026-08-05T05:00:00.000Z', '2026-08-05T05:30:00.000Z'],
    ],
  },
  {
    id: 'three-day-span-over-spring-forward',
    zone: 'Asia/Jerusalem',
    start: '2026-03-26T22:00:00.000Z',
    durMin: 4260,
    rule: 'FREQ=WEEKLY;COUNT=3',
    range: ['2026-03-20T00:00:00.000Z', '2026-05-01T00:00:00.000Z'],
    occurrences: [
      ['2026-03-26T22:00:00.000Z', '2026-03-29T21:00:00.000Z'],
      ['2026-04-02T21:00:00.000Z', '2026-04-05T21:00:00.000Z'],
      ['2026-04-09T21:00:00.000Z', '2026-04-12T21:00:00.000Z'],
    ],
  },
  {
    id: 'ny-weekly-0900-over-us-dst',
    zone: 'America/New_York',
    start: '2026-03-02T14:00:00.000Z',
    durMin: 60,
    rule: 'FREQ=WEEKLY;COUNT=4',
    range: ['2026-03-01T00:00:00.000Z', '2026-04-15T00:00:00.000Z'],
    occurrences: [
      ['2026-03-02T14:00:00.000Z', '2026-03-02T15:00:00.000Z'],
      ['2026-03-09T13:00:00.000Z', '2026-03-09T14:00:00.000Z'],
      ['2026-03-16T13:00:00.000Z', '2026-03-16T14:00:00.000Z'],
      ['2026-03-23T13:00:00.000Z', '2026-03-23T14:00:00.000Z'],
    ],
  },
  {
    id: 'berlin-daily-1000-over-eu-dst',
    zone: 'Europe/Berlin',
    start: '2026-03-26T09:00:00.000Z',
    durMin: 60,
    rule: 'FREQ=DAILY;COUNT=6',
    range: ['2026-03-25T00:00:00.000Z', '2026-04-15T00:00:00.000Z'],
    occurrences: [
      ['2026-03-26T09:00:00.000Z', '2026-03-26T10:00:00.000Z'],
      ['2026-03-27T09:00:00.000Z', '2026-03-27T10:00:00.000Z'],
      ['2026-03-28T09:00:00.000Z', '2026-03-28T10:00:00.000Z'],
      ['2026-03-29T08:00:00.000Z', '2026-03-29T09:00:00.000Z'],
      ['2026-03-30T08:00:00.000Z', '2026-03-30T09:00:00.000Z'],
      ['2026-03-31T08:00:00.000Z', '2026-03-31T09:00:00.000Z'],
    ],
  },
];

const MIN_MS = 60_000;
const endOf = (startIso: string, durMin: number) => new Date(Date.parse(startIso) + durMin * MIN_MS).toISOString();

describe('event-calendar recurrence — wall time in the display zone, on any host zone', () => {
  let runner: HostRunner;

  beforeAll(() => {
    runner = createHostRunner(`
      import { expandRecurrence, parseRRuleString } from '@/components/reui/event-calendar/event-calendar-recurrence';
      const { series, untils } = JSON.parse(process.argv[2]);
      console.log(JSON.stringify({
        host: Intl.DateTimeFormat().resolvedOptions().timeZone,
        series: series.map((c) => {
          const start = new Date(c.start);
          return expandRecurrence(
            { id: c.id, title: c.id, start, end: new Date(start.getTime() + c.durMin * 60000), recurrence: c.rule },
            { start: new Date(c.range[0]), end: new Date(c.range[1]) },
            { timeZone: c.zone },
          ).map((o) => [o.start.toISOString(), o.end.toISOString()]);
        }),
        untils: untils.map(([rule, zone]) => {
          try { return parseRRuleString(rule, zone).until?.toISOString() ?? null; } catch (e) { return 'ERR:' + e.name; }
        }),
      }));
    `);
  }, 30_000);
  afterAll(() => runner.dispose());

  const ALL_SERIES: Series[] = [...DST_SERIES, ...REGRESSION];
  const toArgs = (series: Series[]) => series.map(({ id, zone, start, durMin, rule, range }) => ({ id, zone, start, durMin, rule, range }));

  it.each(HOST_ZONES)('host %s: DST series, UNTIL values and the pre-change regression series all come out the same', (host) => {
    const out = runner.run<{ host: string; series: Array<Array<[string, string]>>; untils: string[] }>(host, {
      series: toArgs(ALL_SERIES),
      untils: UNTILS.map(([rule, zone]) => [rule, zone]),
    });
    // The child really ran under the requested host zone.
    expect(out.host).toBe(host);

    const mismatches: string[] = [];
    DST_SERIES.forEach((s, i) => {
      const want = s.starts.map((start) => [start, endOf(start, s.durMin)]);
      if (JSON.stringify(out.series[i]) !== JSON.stringify(want)) {
        mismatches.push(`${s.id}: got ${JSON.stringify(out.series[i]?.map((o) => o[0]))}, want ${JSON.stringify(s.starts)}`);
      }
    });
    REGRESSION.forEach((s, k) => {
      const i = DST_SERIES.length + k;
      if (JSON.stringify(out.series[i]) !== JSON.stringify(s.occurrences)) {
        mismatches.push(`${s.id}: differs from the pre-change timestamps`);
      }
    });
    UNTILS.forEach(([rule, zone, want], i) => {
      if (out.untils[i] !== want) mismatches.push(`${rule} in ${zone}: got ${out.untils[i]}, want ${want}`);
    });
    expect(mismatches).toEqual([]);
  });

  it('keeps the milliseconds of an occurrence: DTSTART …:00.123 repeats as …:00.123, overlap and gap included', () => {
    const series: Series[] = [
      {
        id: 'ms-overlap',
        zone: IL,
        start: '2026-10-22T22:30:00.123Z',
        durMin: 60,
        rule: 'FREQ=DAILY;COUNT=4',
        range: ['2026-10-22T00:00:00.000Z', '2026-10-30T00:00:00.000Z'],
      },
      {
        id: 'ms-gap',
        zone: IL,
        start: '2026-03-25T00:30:00.456Z',
        durMin: 60,
        rule: 'FREQ=DAILY;COUNT=4',
        range: ['2026-03-25T00:00:00.000Z', '2026-03-31T00:00:00.000Z'],
      },
    ];
    for (const host of ['Asia/Jerusalem', 'UTC', 'Europe/Athens', 'Australia/Lord_Howe']) {
      const out = runner.run<{ series: Array<Array<[string, string]>> }>(host, { series: toArgs(series), untils: [] });
      expect(out.series[0].map((o) => o[0]), `ms-overlap on ${host}`).toEqual([
        '2026-10-22T22:30:00.123Z',
        '2026-10-23T22:30:00.123Z',
        '2026-10-24T22:30:00.123Z',
        '2026-10-25T23:30:00.123Z',
      ]);
      expect(out.series[1].map((o) => o[0]), `ms-gap on ${host}`).toEqual([
        '2026-03-25T00:30:00.456Z',
        '2026-03-26T00:30:00.456Z',
        '2026-03-27T00:30:00.456Z',
        '2026-03-27T23:30:00.456Z',
      ]);
    }
  });
});
