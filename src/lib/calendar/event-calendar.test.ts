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
