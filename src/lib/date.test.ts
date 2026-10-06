import { describe, expect, it } from 'vitest';

import {
  ISRAEL_LOCALE,
  ISRAEL_TIME_ZONE,
  formatIsraelDate,
  formatIsraelDateTime,
  formatIsraelHebrewDate,
  formatIsraelRelativeSpokenDate,
  formatIsraelSpokenClock,
  formatIsraelTime,
  formatIsraelWeekday,
} from './date';

describe('Israel display formatters', () => {
  it('exports the canonical locale and time zone', () => {
    expect(ISRAEL_LOCALE).toBe('he-IL');
    expect(ISRAEL_TIME_ZONE).toBe('Asia/Jerusalem');
  });

  it('formats a summer (IDT, +03:00) instant as Israel wall clock', () => {
    // The brit: stored UTC 14:30Z → 17:30 in Israel.
    expect(formatIsraelDateTime('2026-07-12T14:30:00.000Z')).toBe(
      '12.07.2026, 17:30',
    );
    expect(formatIsraelTime('2026-07-12T14:30:00.000Z')).toBe('17:30');
  });

  it('formats a winter (IST, +02:00) instant — DST switch is automatic', () => {
    expect(formatIsraelDateTime('2026-01-15T10:00:00.000Z')).toBe(
      '15.01.2026, 12:00',
    );
  });

  it('uses h23 — midnight renders as 00:xx, never 24:xx or AM/PM', () => {
    expect(formatIsraelTime('2026-07-11T21:30:00.000Z')).toBe('00:30');
  });

  it('shows the ISRAEL calendar day, not the UTC day', () => {
    // 22:00Z is already 01:00 the NEXT day in Israel — a raw slice(0,10) of
    // the ISO string would report the 11th; the formatter must say the 12th.
    expect(formatIsraelDate('2026-07-11T22:00:00.000Z')).toBe('12.07.2026');
  });

  it('accepts Date, epoch ms, and plain date-column strings', () => {
    expect(formatIsraelDate(new Date('2026-07-12T14:30:00Z'))).toBe('12.07.2026');
    expect(formatIsraelDate(Date.parse('2026-07-12T14:30:00Z'))).toBe('12.07.2026');
    expect(formatIsraelDate('2026-07-12')).toBe('12.07.2026');
  });

  it('returns an empty string for invalid input instead of throwing', () => {
    expect(formatIsraelDate('not-a-date')).toBe('');
    expect(formatIsraelDateTime('')).toBe('');
    expect(formatIsraelTime('garbage')).toBe('');
  });
});

describe('Israel weekday + Hebrew-calendar formatters', () => {
  it('renders the bare Israel weekday (no "יום " prefix)', () => {
    // 2026-07-12 (the brit) is a Sunday in Israel.
    expect(formatIsraelWeekday('2026-07-12T12:00:00+03:00')).toBe('ראשון');
  });

  it('renders the Hebrew (gematria) calendar date', () => {
    expect(formatIsraelHebrewDate('2026-07-12T12:00:00+03:00')).toBe('כ״ז בתמוז תשפ״ו');
    // 15 Nisan (Pesach) exercises the טו special case — never spelled י״ה.
    expect(formatIsraelHebrewDate('2026-04-02T12:00:00+03:00')).toBe('ט״ו בניסן תשפ״ו');
  });

  it('follows the Israel civil day, not the UTC day', () => {
    // 21:30Z on 2026-07-11 is already 00:30 the next day in Israel → the 12th.
    expect(formatIsraelHebrewDate('2026-07-11T21:30:00.000Z')).toBe('כ״ז בתמוז תשפ״ו');
    expect(formatIsraelWeekday('2026-07-11T21:30:00.000Z')).toBe('ראשון');
  });

  it('returns an empty string for invalid input instead of throwing', () => {
    expect(formatIsraelWeekday('not-a-date')).toBe('');
    expect(formatIsraelHebrewDate('')).toBe('');
  });
});

// --- Spoken clock & relative date --------------------------------------------
// ⚠️ These feed an ElevenLabs agent that speaks the string VERBATIM. There is no
// `normalizeForSpeech` on the MeetingConfirm path (only the RSVP scenarios have
// one), so a digit that survives here is a digit a caller hears. Every hour is
// pinned, not spot-checked: the feminine forms, the 11–19 block and the tens
// compounds are each a separate way to get Hebrew wrong.

describe('formatIsraelSpokenClock', () => {
  // Israel is UTC+3 (IDT) in September.
  const at = (h: number, m: number) =>
    `2026-09-14T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

  it.each([
    [16, 3, 'בארבע ושלוש דקות אחר הצהריים'],
    [16, 18, 'בארבע ושמונה עשרה דקות אחר הצהריים'],
    [16, 0, 'בארבע אחר הצהריים'],
    [16, 15, 'בארבע ורבע אחר הצהריים'],
    [16, 30, 'בארבע וחצי אחר הצהריים'],
    [16, 1, 'בארבע ודקה אחת אחר הצהריים'],
    [16, 45, 'בארבע וארבעים וחמש דקות אחר הצהריים'],
    [16, 59, 'בארבע וחמישים ותשע דקות אחר הצהריים'],
    [16, 20, 'בארבע ועשרים דקות אחר הצהריים'],
    [16, 21, 'בארבע ועשרים ואחת דקות אחר הצהריים'],
    [16, 11, 'בארבע ואחת עשרה דקות אחר הצהריים'],
    [9, 5, 'בתשע וחמש דקות בבוקר'],
    [11, 0, 'באחת עשרה בבוקר'],
    [12, 0, 'בשתים עשרה בצהריים'],
    [12, 30, 'בשתים עשרה וחצי בצהריים'],
    [13, 0, 'באחת אחר הצהריים'],
    [17, 59, 'בחמש וחמישים ותשע דקות אחר הצהריים'],
    [18, 0, 'בשש בערב'],
    [21, 30, 'בתשע וחצי בערב'],
    [22, 0, 'בעשר בלילה'],
    [5, 0, 'בחמש בבוקר'],
    [4, 59, 'בארבע וחמישים ותשע דקות בלילה'],
  ])('%s:%s → %s', (h, m, expected) => {
    expect(formatIsraelSpokenClock(at(h, m))).toBe(expected);
  });

  it('⚠️ midnight is twelve, never zero', () => {
    // `hourCycle: 'h23'` gives 0; "ב אחר הצהריים" or "באפס" would both be wrong.
    expect(formatIsraelSpokenClock('2026-09-13T21:00:00Z')).toBe('בשתים עשרה בלילה');
  });

  it('⚠️ no digit ever survives', () => {
    for (let h = 0; h < 24; h += 1) {
      for (const m of [0, 1, 7, 15, 19, 30, 42, 59]) {
        const out = formatIsraelSpokenClock(
          Date.UTC(2026, 8, 14, h - 3, m, 0),
        );
        expect(out, `${h}:${m} → ${out}`).not.toMatch(/\d/);
        expect(out.trim(), `${h}:${m}`).not.toBe('');
      }
    }
  });

  it('returns empty for unparseable input', () => {
    expect(formatIsraelSpokenClock('')).toBe('');
    expect(formatIsraelSpokenClock('not-a-date')).toBe('');
  });
});

describe('formatIsraelRelativeSpokenDate', () => {
  // 2026-09-14 is a Monday; 14:00 Israel time.
  const now = '2026-09-14T11:00:00Z';

  it.each([
    ['2026-09-14T13:18:00Z', 'היום'],
    ['2026-09-14T20:59:00Z', 'היום'],
    ['2026-09-15T05:00:00Z', 'מחר'],
    ['2026-09-16T05:00:00Z', 'מחרתיים'],
    ['2026-09-17T05:00:00Z', 'ביום חמישי'],
    ['2026-09-20T05:00:00Z', 'ביום ראשון'],
    ['2026-09-21T05:00:00Z', 'ביום שני, בעשרים ואחד בספטמבר'],
    ['2026-10-01T05:00:00Z', 'ביום חמישי, באחד באוקטובר'],
  ])('%s → %s', (when, expected) => {
    expect(formatIsraelRelativeSpokenDate(when, now)).toBe(expected);
  });

  it('⚠️ the year is spoken ONLY when it is not the current one', () => {
    expect(formatIsraelRelativeSpokenDate('2027-01-04T05:00:00Z', now)).toBe(
      'ביום שני, בארבעה בינואר אלפיים עשרים ושבע',
    );
  });

  it('⚠️ a past date yields nothing, never a confident wrong date', () => {
    expect(formatIsraelRelativeSpokenDate('2026-09-13T18:00:00Z', now)).toBe('');
  });

  it('⚠️ "today" follows the Israel civil day, not UTC', () => {
    // 2026-09-14T22:30 Israel = 19:30Z — still today in Israel, already
    // "tomorrow" nowhere. A UTC-based diff would be right here by luck; the
    // real trap is the other side of midnight.
    expect(formatIsraelRelativeSpokenDate('2026-09-14T19:30:00Z', now)).toBe('היום');
    // 2026-09-14T21:30Z = 00:30 on the 15th in Israel → tomorrow.
    expect(formatIsraelRelativeSpokenDate('2026-09-14T21:30:00Z', now)).toBe('מחר');
  });

  it('returns empty for unparseable input', () => {
    expect(formatIsraelRelativeSpokenDate('', now)).toBe('');
    expect(formatIsraelRelativeSpokenDate('2026-09-20T05:00:00Z', 'nope')).toBe('');
  });
});
