import { describe, expect, it } from 'vitest';

import { OWNER_AGENT_RANGES, RANGE_DAYS, israelMidnightIso, rangeStartIso } from './range';

describe('rangeStartIso', () => {
  it('the range enum is exactly today | 7d | 30d', () => {
    expect([...OWNER_AGENT_RANGES]).toEqual(['today', '7d', '30d']);
  });

  it("'today' is Israel midnight, not UTC midnight (summer, IDT +03:00)", () => {
    // 22:30 UTC on the 24th is 01:30 on the 25th in Israel: the UTC date and
    // the Israel date differ, so a UTC-midnight or slice(0,10) bug shows here.
    const now = Date.parse('2026-09-24T22:30:00Z');
    expect(rangeStartIso('today', now)).toBe('2026-09-24T21:00:00.000Z');
  });

  it("'today' is Israel midnight in winter (IST +02:00)", () => {
    const now = Date.parse('2026-01-15T23:30:00Z'); // 01:30 on the 16th in Israel
    expect(rangeStartIso('today', now)).toBe('2026-01-15T22:00:00.000Z');
  });

  it("'today' mid-day: same Israel and UTC date", () => {
    const now = Date.parse('2026-09-24T10:00:00Z'); // 13:00 Israel
    expect(rangeStartIso('today', now)).toBe('2026-09-23T21:00:00.000Z');
  });

  it("'7d' and '30d' are rolling N × 24h windows ending now", () => {
    const now = Date.parse('2026-09-24T22:30:00Z');
    expect(rangeStartIso('7d', now)).toBe('2026-09-17T22:30:00.000Z');
    expect(rangeStartIso('30d', now)).toBe('2026-08-25T22:30:00.000Z');
  });
});

// Regression (13.10.2026): Israel midnight on the two DST-switch days used to be computed with the
// offset of NOON that day, an hour off. The switch is at 02:00, so midnight still has the OLD offset.
describe('rangeStartIso / israelMidnightIso on the DST-switch days', () => {
  it("'today' on the spring-forward day (27.3.2026) starts at 00:00 IST = 22:00Z the day before", () => {
    const now = Date.parse('2026-03-27T12:00:00Z'); // 15:00 IDT on the 27th
    expect(rangeStartIso('today', now)).toBe('2026-03-26T22:00:00.000Z');
  });

  it("'today' on the fall-back day (25.10.2026) starts at 00:00 IDT = 21:00Z the day before", () => {
    const now = Date.parse('2026-10-25T12:00:00Z'); // 14:00 IST on the 25th
    expect(rangeStartIso('today', now)).toBe('2026-10-24T21:00:00.000Z');
  });

  it('israelMidnightIso lands on the right midnight when the target day is a switch day', () => {
    const beforeSpring = Date.parse('2026-03-26T12:00:00Z');
    expect(israelMidnightIso(beforeSpring, 1)).toBe('2026-03-26T22:00:00.000Z'); // 27.3 00:00 IST
    expect(israelMidnightIso(beforeSpring, 2)).toBe('2026-03-27T21:00:00.000Z'); // 28.3 00:00 IDT
    const beforeAutumn = Date.parse('2026-10-24T12:00:00Z');
    expect(israelMidnightIso(beforeAutumn, 1)).toBe('2026-10-24T21:00:00.000Z'); // 25.10 00:00 IDT
    expect(israelMidnightIso(beforeAutumn, 2)).toBe('2026-10-25T22:00:00.000Z'); // 26.10 00:00 IST
  });
});

describe('israelMidnightIso', () => {
  it('offset 0 equals rangeStartIso(today); offsets count Israel days, not UTC days', () => {
    const now = Date.parse('2026-09-24T22:30:00Z'); // 01:30 on the 25th in Israel
    expect(israelMidnightIso(now, 0)).toBe(rangeStartIso('today', now));
    expect(israelMidnightIso(now, 1)).toBe('2026-09-25T21:00:00.000Z'); // 26th 00:00 IDT
    expect(israelMidnightIso(now, 7)).toBe('2026-10-01T21:00:00.000Z');
  });

  it('a window that crosses the end of DST picks up the winter offset', () => {
    // Israel leaves DST on 2026-10-25. 13:00 IDT on the 20th + 7 days = the
    // 27th, whose midnight is 00:00 IST (+02:00).
    const now = Date.parse('2026-10-20T10:00:00Z');
    expect(israelMidnightIso(now, 0)).toBe('2026-10-19T21:00:00.000Z');
    expect(israelMidnightIso(now, 7)).toBe('2026-10-26T22:00:00.000Z');
  });

  it('counts whole calendar days across month and year ends, and backwards', () => {
    const lateDecember = Date.parse('2026-12-30T10:00:00Z'); // 12:00 IST on the 30th
    expect(israelMidnightIso(lateDecember, 2)).toBe('2026-12-31T22:00:00.000Z'); // 1.1.2027 00:00 IST
    expect(israelMidnightIso(lateDecember, -30)).toBe('2026-11-29T22:00:00.000Z'); // 30.11.2026 00:00 IST
    const lateFebruary = Date.parse('2026-02-27T10:00:00Z');
    expect(israelMidnightIso(lateFebruary, 3)).toBe('2026-03-01T22:00:00.000Z'); // 2.3.2026 00:00 IST
  });

  it('rejects an offset that is not a whole number of days', () => {
    expect(() => israelMidnightIso(Date.parse('2026-09-24T10:00:00Z'), 1.5)).toThrow(RangeError);
  });

  it('RANGE_DAYS: today = 1, 7d = 7, 30d = 30', () => {
    expect(RANGE_DAYS).toEqual({ today: 1, '7d': 7, '30d': 30 });
  });
});
