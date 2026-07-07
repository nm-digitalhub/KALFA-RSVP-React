import { describe, expect, it } from 'vitest';

import { buildJewishCalendar } from './jewish-calendar';

// Known Jerusalem Shabbat (verified against hebcal 6.6.0):
//   Fri 2026-07-03 candle-lighting 19:08 IDT (16:08Z)
//   Sat 2026-07-04 havdalah        20:30 IDT (17:30Z)
const HAVDALAH_2026_07_04 = Date.parse('2026-07-04T17:30:00Z');

describe('buildJewishCalendar (hebcal, Jerusalem)', () => {
  const cal = buildJewishCalendar(
    Date.parse('2026-07-01T00:00:00Z'),
    Date.parse('2026-07-10T00:00:00Z'),
  );

  it('blocks Friday evening and all of Shabbat', () => {
    expect(cal.isBlocked(Date.parse('2026-07-03T20:00:00+03:00'))).toBe(true); // Fri 20:00
    expect(cal.isBlocked(Date.parse('2026-07-04T10:00:00+03:00'))).toBe(true); // Sat 10:00
    expect(cal.isBlocked(Date.parse('2026-07-04T20:00:00+03:00'))).toBe(true); // Sat 20:00 (< havdalah 20:30)
  });

  it('does NOT block Friday morning (before candle-lighting) or Sunday', () => {
    expect(cal.isBlocked(Date.parse('2026-07-03T11:00:00+03:00'))).toBe(false); // Fri 11:00
    expect(cal.isBlocked(Date.parse('2026-07-05T10:00:00+03:00'))).toBe(false); // Sun 10:00
  });

  it('does NOT block a fast day (Tzom) — only Shabbat/Yom-Tov', () => {
    // Tzom Tammuz 2026-07-01 daytime is a fast, not a send-block.
    expect(cal.isBlocked(Date.parse('2026-07-01T12:00:00+03:00'))).toBe(false);
  });

  it('nextClear of a Shabbat instant returns the havdalah instant', () => {
    expect(cal.nextClear(Date.parse('2026-07-04T10:00:00+03:00'))).toBe(
      HAVDALAH_2026_07_04,
    );
  });

  it('nextClear of an unblocked instant is unchanged', () => {
    const t = Date.parse('2026-07-05T10:00:00+03:00');
    expect(cal.nextClear(t)).toBe(t);
  });

  it('nextBlockedStart returns the upcoming candle-lighting', () => {
    // From Fri noon → the candle-lighting that evening (2026-07-03 16:08Z).
    expect(cal.nextBlockedStart(Date.parse('2026-07-03T12:00:00+03:00'))).toBe(
      Date.parse('2026-07-03T16:08:00Z'),
    );
  });

  it('nextAllowedAt applies the resume delay after havdalah', () => {
    const delay = 60 * 60_000;
    // Inside Shabbat → havdalah + 60 min.
    expect(cal.nextAllowedAt(Date.parse('2026-07-04T10:00:00+03:00'), delay)).toBe(
      HAVDALAH_2026_07_04 + delay,
    );
    // In the resume gap (10 min after havdalah) → still havdalah + 60 min.
    expect(cal.nextAllowedAt(HAVDALAH_2026_07_04 + 10 * 60_000, delay)).toBe(
      HAVDALAH_2026_07_04 + delay,
    );
    // Well clear of any block → unchanged.
    const clear = Date.parse('2026-07-05T10:00:00+03:00');
    expect(cal.nextAllowedAt(clear, delay)).toBe(clear);
  });
});

describe('buildJewishCalendar — edge coverage', () => {
  it('a Shabbat→chag adjacency is ONE continuous block (no motzaei-Shabbat gap)', () => {
    // 2026-09-11 (Fri) Shabbat runs straight into a chag; hebcal emits a
    // candle-lighting Sat night (NOT havdalah), so the block is continuous
    // through Saturday night — a send must never slip in there.
    const cal = buildJewishCalendar(
      Date.parse('2026-09-10T00:00:00Z'),
      Date.parse('2026-09-14T00:00:00Z'),
    );
    expect(cal.isBlocked(Date.parse('2026-09-12T22:00:00+03:00'))).toBe(true); // Sat night
    expect(cal.isBlocked(Date.parse('2026-09-13T10:00:00+03:00'))).toBe(true); // Sun (chag)
    // nextClear from Saturday jumps to the FINAL havdalah, not a Saturday one.
    expect(cal.nextClear(Date.parse('2026-09-12T10:00:00+03:00'))).toBe(
      Date.parse('2026-09-13T16:24:00Z'),
    );
  });

  it('still blocks Shabbat when the requested range STARTS on Saturday morning', () => {
    // Padding before the range start must capture Friday's candle-lighting.
    const cal = buildJewishCalendar(
      Date.parse('2026-07-04T08:00:00+03:00'), // Saturday morning
      Date.parse('2026-07-04T23:00:00+03:00'),
    );
    expect(cal.isBlocked(Date.parse('2026-07-04T10:00:00+03:00'))).toBe(true);
  });
});
