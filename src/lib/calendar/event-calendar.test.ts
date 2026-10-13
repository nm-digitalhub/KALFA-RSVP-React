import { describe, expect, it } from 'vitest';

import {
  buildCalendarEvent,
  buildCalendarLinks,
  calendarUid,
  icsFileName,
  renderIcs,
  sanitizeCalendarText,
  type CalendarEventInput,
} from './event-calendar';

const base: CalendarEventInput = {
  name: 'האירוע של דני',
  event_type: 'birthday',
  event_date: '2026-07-12T17:30:00Z',
  venue_name: null,
  venue_address: null,
  celebrants: { name: 'דני' },
};

describe('buildCalendarEvent', () => {
  it('null for a missing/invalid event_date (no anchor to build an entry on)', () => {
    expect(buildCalendarEvent({ ...base, event_date: null })).toBeNull();
    expect(buildCalendarEvent({ ...base, event_date: 'not-a-date' })).toBeNull();
  });

  it('timed event → absolute instants, 3h default end, Israel calendar day, sanitized title/filename', () => {
    expect(buildCalendarEvent(base)).toEqual({
      title: 'יום ההולדת של דני',
      location: null,
      startMs: Date.parse('2026-07-12T17:30:00Z'),
      endMs: Date.parse('2026-07-12T20:30:00Z'),
      timed: true,
      israelDay: '2026-07-12',
      fileName: 'יום-ההולדת-של-דני',
    });
  });

  it('an instant late in the UTC day is the NEXT Israel calendar day', () => {
    // 22:30Z = 01:30 IDT on the 13th.
    expect(buildCalendarEvent({ ...base, event_date: '2026-07-12T22:30:00Z' })!.israelDay).toBe('2026-07-13');
  });

  it('legacy date-only event_date (midnight UTC) → all-day', () => {
    const built = buildCalendarEvent({ ...base, event_date: '2026-07-12T00:00:00+00:00' })!;
    expect(built.timed).toBe(false);
    expect(built.israelDay).toBe('2026-07-12');
  });

  it('joins venue name + address into one location, null when both are empty', () => {
    expect(buildCalendarEvent({ ...base, venue_name: 'אולמי הגן', venue_address: 'הרצל 1, תל אביב' })!.location).toBe(
      'אולמי הגן, הרצל 1, תל אביב',
    );
    expect(buildCalendarEvent(base)!.location).toBeNull();
  });
});

describe('sanitizeCalendarText / icsFileName', () => {
  it('folds newlines and control characters into single spaces', () => {
    expect(sanitizeCalendarText('שורה\r\nURL:https://evil.example\u0007 x')).toBe('שורה URL:https://evil.example x');
  });

  it('filename: strips path/quote characters, hyphenates whitespace, caps length', () => {
    expect(icsFileName('החתונה של דנה ויוסי')).toBe('החתונה-של-דנה-ויוסי');
    expect(icsFileName('a/b\\c:d*e?f"g<h>i|jk')).toBe('a-b-c-d-e-f-g-h-i-jk');
    expect(icsFileName('   ')).toBe('event');
    expect(icsFileName('x'.repeat(100))).toHaveLength(60);
  });
});

describe('buildCalendarLinks (calendar-link)', () => {
  const built = buildCalendarEvent({ ...base, venue_name: 'אולמי הגן', venue_address: 'הרצל 1' })!;

  it('Google: TEMPLATE form with the absolute UTC instant', () => {
    const { google } = buildCalendarLinks(built);
    expect(google).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    expect(google).toContain('dates=20260712T173000Z%2F20260712T203000Z');
    expect(decodeURIComponent(google)).toContain('text=יום ההולדת של דני');
    expect(decodeURIComponent(google)).toContain('location=אולמי הגן, הרצל 1');
  });

  it('Outlook.com / Microsoft 365: compose deep links with Israel wall-clock times (calendar-link, process TZ)', () => {
    const { outlookcom, ms365 } = buildCalendarLinks(built);
    expect(outlookcom).toMatch(/^https:\/\/outlook\.live\.com\/calendar\/0\/action\/compose\?/);
    expect(ms365).toMatch(/^https:\/\/outlook\.office\.com\/calendar\/0\/action\/compose\?/);
    for (const url of [outlookcom, ms365]) {
      expect(url).toContain('rru=addevent');
      // calendar-link emits Outlook times as zoneless LOCAL wall clock of the
      // process (dateTimeLocal); vitest pins TZ=Asia/Jerusalem exactly like the
      // pm2 ecosystem does for the app, so this is the Israel wall time.
      expect(decodeURIComponent(url)).toContain('startdt=2026-07-12T20:30:00');
      expect(decodeURIComponent(url)).toContain('enddt=2026-07-12T23:30:00');
      expect(decodeURIComponent(url)).toContain('subject=יום ההולדת של דני');
    }
  });

  it('all-day Google link uses the Israel day as date-only bounds (next day exclusive)', () => {
    const allDay = buildCalendarEvent({ ...base, event_date: '2026-07-12T00:00:00+00:00' })!;
    expect(buildCalendarLinks(allDay).google).toContain('dates=20260712%2F20260713');
  });
});

describe('renderIcs (ics package)', () => {
  const built = buildCalendarEvent({ ...base, venue_name: 'אולמי הגן', venue_address: 'הרצל 1' })!;

  it('emits one VEVENT with UTC instants, title + location, a stable opaque UID and nothing else', () => {
    const ics = renderIcs(built, 'event-uuid-1');
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r?\n/);
    expect(ics).toContain('DTSTART:20260712T173000Z');
    expect(ics).toContain('DTEND:20260712T203000Z');
    expect(ics).toContain('SUMMARY:יום ההולדת של דני');
    expect(ics).toContain('LOCATION:אולמי הגן\\, הרצל 1');
    expect(ics).toContain(`UID:${calendarUid('event-uuid-1')}`);
    expect(ics).not.toContain('event-uuid-1'); // the seed itself never appears
    expect(ics).not.toMatch(/ATTENDEE|ORGANIZER|DESCRIPTION|URL:|X-WR-CALNAME/);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
  });

  it('the UID is deterministic per seed and differs across seeds', () => {
    expect(calendarUid('a')).toBe(calendarUid('a'));
    expect(calendarUid('a')).not.toBe(calendarUid('b'));
    expect(calendarUid('a')).toMatch(/^[0-9a-f]{32}@kalfa\.me$/);
  });

  it('all-day entry uses VALUE=DATE bounds on the Israel day', () => {
    const allDay = buildCalendarEvent({ ...base, event_date: '2026-07-12T00:00:00+00:00' })!;
    const ics = renderIcs(allDay);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20260712/);
    expect(ics).toMatch(/DTEND;VALUE=DATE:20260713/);
  });

  // The DTEND of an all-day entry is the NEXT CALENDAR day (RFC 5545: exclusive) — a date plus one day, never an
  // instant plus 24h. Pinned for an ordinary day, around both Israel DST switches (the 23-hour 27.3.2026 and the
  // 25-hour 25.10.2026) and across month, year and leap-day boundaries. The expected bounds are written out, so a
  // change to how the next day is computed cannot move them.
  it.each([
    ['2026-07-12', '20260712', '20260713'], // ordinary summer day
    ['2026-01-15', '20260115', '20260116'], // ordinary winter day
    ['2026-03-26', '20260326', '20260327'], // the day before the spring switch
    ['2026-03-27', '20260327', '20260328'], // spring switch day (23h)
    ['2026-03-28', '20260328', '20260329'], // the day after it
    ['2026-10-24', '20261024', '20261025'], // the day before the autumn switch
    ['2026-10-25', '20261025', '20261026'], // autumn switch day (25h)
    ['2026-10-26', '20261026', '20261027'], // the day after it
    ['2026-12-31', '20261231', '20270101'], // year end
    ['2026-02-28', '20260228', '20260301'], // February, common year
    ['2028-02-28', '20280228', '20280229'], // February, leap year
    ['2028-02-29', '20280229', '20280301'], // leap day
  ])('all-day %s: DTSTART;VALUE=DATE:%s and DTEND;VALUE=DATE:%s', (day, start, end) => {
    const allDay = buildCalendarEvent({ ...base, event_date: `${day}T00:00:00+00:00` })!;
    const ics = renderIcs(allDay);
    expect(ics).toContain(`DTSTART;VALUE=DATE:${start}`);
    expect(ics).toContain(`DTEND;VALUE=DATE:${end}`);
  });

  it('every day of 2026 and of the leap year 2028 ends on the same date as the previous noon-plus-24h computation', () => {
    // The computation this replaced, kept here only as the reference the new one must reproduce.
    const legacyNextDay = (day: string) => {
      const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      return next.replaceAll('-', '');
    };
    for (const year of [2026, 2028]) {
      for (let ms = Date.UTC(year, 0, 1); ms <= Date.UTC(year, 11, 31); ms += 86_400_000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        const ics = renderIcs(buildCalendarEvent({ ...base, event_date: `${day}T00:00:00+00:00` })!);
        expect(ics, day).toContain(`DTSTART;VALUE=DATE:${day.replaceAll('-', '')}`);
        expect(ics, day).toContain(`DTEND;VALUE=DATE:${legacyNextDay(day)}`);
      }
    }
  });

  it('a title with an embedded newline cannot inject a property line', () => {
    const evil = buildCalendarEvent({ ...base, name: 'מסיבה\nURL:https://evil.example', event_type: 'other', celebrants: null })!;
    const ics = renderIcs(evil);
    const lines = ics.split(/\r?\n/);
    expect(lines.some((l) => l.startsWith('URL:'))).toBe(false);
    expect(ics).toContain('SUMMARY:מסיבה URL:https://evil.example');
  });

  it('8 concurrent generations (links + ICS, mixed) all resolve with the right values', async () => {
    const other = buildCalendarEvent({ ...base, name: 'חתונה', event_type: 'wedding', celebrants: { groom: 'א', bride: 'ב' } })!;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        Promise.resolve().then(() => (i % 2 === 0 ? buildCalendarLinks(i % 4 === 0 ? built : other).google : renderIcs(i % 4 === 1 ? built : other))),
      ),
    );
    expect(results).toHaveLength(8);
    for (const [i, r] of results.entries()) {
      if (i % 2 === 0) expect(r).toMatch(/^https:\/\/calendar\.google\.com\//);
      else expect(r).toContain('BEGIN:VEVENT');
    }
    expect(results[0]).toContain(encodeURIComponent('יום ההולדת של דני'));
    expect(results[2]).toContain(encodeURIComponent('החתונה של א וב'));
    expect(results[1]).toContain('SUMMARY:יום ההולדת של דני');
    expect(results[3]).toContain('SUMMARY:החתונה של א וב');
  });
});
