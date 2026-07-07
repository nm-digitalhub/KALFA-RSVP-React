import { describe, expect, it } from 'vitest';

import {
  ISRAEL_LOCALE,
  ISRAEL_TIME_ZONE,
  formatIsraelDate,
  formatIsraelDateTime,
  formatIsraelHebrewDate,
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
