import { describe, expect, it } from 'vitest';

import {
  buildCancelledSubject,
  buildCancelledUpdate,
  buildEventAppointmentDraft,
  buildEventBody,
  buildEventSubject,
  buildRsvpDeadlineDraft,
  buildRsvpDeadlineSubject,
  EVENT_EXCHANGE_CANCELLED_CATEGORY,
  EVENT_EXCHANGE_CATEGORY,
  EVENT_EXCHANGE_REMINDER_MINUTES,
} from './event-exchange-calendar-item';

describe('buildEventSubject', () => {
  it('uses the possessive heading alone when eventHeadingFor has no subtitle', () => {
    expect(
      buildEventSubject({
        eventType: 'wedding',
        celebrants: { groom: 'יוסי', bride: 'דנה' },
        eventName: 'האירוע שלנו',
      }),
    ).toBe('החתונה של יוסי ודנה');
  });

  it('appends the subtitle in parens for the "parents" kind (brit)', () => {
    expect(
      buildEventSubject({
        eventType: 'brit',
        celebrants: { parents: 'נטלי כהן', child: 'בני' },
        eventName: 'ברית של בני',
      }),
    ).toBe('ברית (ההורים: נטלי כהן — לכבוד בני)');
  });

  it('falls back to the raw event name when there is nothing to compose', () => {
    expect(
      buildEventSubject({ eventType: 'other', celebrants: null, eventName: 'מסיבת סיום' }),
    ).toBe('מסיבת סיום');
  });
});

describe('buildRsvpDeadlineSubject', () => {
  it('prefixes the composed subject', () => {
    expect(
      buildRsvpDeadlineSubject({
        eventType: 'birthday',
        celebrants: { name: 'נועה' },
        eventName: 'יום הולדת',
      }),
    ).toBe('מועד אחרון לאישור הגעה — יום ההולדת של נועה');
  });
});

describe('buildEventBody', () => {
  it('includes the notes verbatim (newlines as <br>) and a link to the event', () => {
    const body = buildEventBody({
      notes: 'להזמין קייטרינג\nלוודא הגברה',
      detailUrl: 'https://beta.kalfa.me/app/events/e1',
    });
    expect(body).toContain('להזמין קייטרינג<br>לוודא הגברה');
    expect(body).toContain('<a href="https://beta.kalfa.me/app/events/e1">פתיחת האירוע ב-KALFA</a>');
    expect(body).toContain('dir="rtl"');
  });

  it('omits the notes block entirely when there are none', () => {
    const body = buildEventBody({ notes: null, detailUrl: 'https://beta.kalfa.me/app/events/e1' });
    expect(body).not.toContain('<br>');
    expect(body).toContain('פתיחת האירוע ב-KALFA');
  });

  it('HTML-escapes both notes and the URL', () => {
    const body = buildEventBody({
      notes: '<script>alert(1)</script> & "תגובה"',
      detailUrl: 'https://beta.kalfa.me/app/events/e1?x="&y=<1>',
    });
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
    expect(body).toContain('&amp;');
    expect(body).not.toContain('x="&y=<1>');
  });
});

describe('buildEventAppointmentDraft', () => {
  const base = {
    eventType: 'wedding' as const,
    celebrants: { groom: 'יוסי', bride: 'דנה' },
    eventName: 'האירוע שלנו',
    eventDateIso: '2026-09-01T18:00:00.000Z',
    notes: null,
    detailUrl: 'https://beta.kalfa.me/app/events/e1',
  };

  it('is a 4-hour block starting at event_date, category + reminder set, HTML body', () => {
    const draft = buildEventAppointmentDraft(base);
    expect(draft.start).toEqual(new Date('2026-09-01T18:00:00.000Z'));
    expect(draft.end).toEqual(new Date('2026-09-01T22:00:00.000Z'));
    expect(draft.category).toBe(EVENT_EXCHANGE_CATEGORY);
    expect(draft.reminderMinutes).toBe(EVENT_EXCHANGE_REMINDER_MINUTES);
    expect(draft.bodyIsHtml).toBe(true);
    expect(draft.allDay).toBeUndefined();
  });
});

describe('buildRsvpDeadlineDraft', () => {
  const heading = {
    eventType: 'wedding' as const,
    celebrants: { groom: 'יוסי', bride: 'דנה' },
    eventName: 'האירוע שלנו',
  };
  const hours = (d: { start: Date; end: Date }) => (d.end.getTime() - d.start.getTime()) / 3_600_000;

  it('is an all-day, free-showing item with no reminder, in the KALFA category', () => {
    const draft = buildRsvpDeadlineDraft({
      ...heading,
      startIsoMidnight: '2026-08-25T21:00:00.000+00:00', // Israel midnight (IDT, +03:00) for 2026-08-26
      endIsoMidnight: '2026-08-26T21:00:00.000+00:00', // Israel midnight for 2026-08-27
    });
    expect(draft.allDay).toBe(true);
    expect(draft.showAs).toBe('free');
    expect(draft.category).toBe(EVENT_EXCHANGE_CATEGORY);
    expect(draft.reminderMinutes).toBeUndefined();
    expect(draft.subject).toContain('מועד אחרון לאישור הגעה');
  });

  // The end is the Israel midnight of the NEXT calendar day, as given — never start + 24h.
  it('an ordinary day: two consecutive Israel midnights, 24 hours apart', () => {
    const draft = buildRsvpDeadlineDraft({
      ...heading,
      startIsoMidnight: '2026-08-25T21:00:00.000Z',
      endIsoMidnight: '2026-08-26T21:00:00.000Z',
    });
    expect(draft.start.toISOString()).toBe('2026-08-25T21:00:00.000Z');
    expect(draft.end.toISOString()).toBe('2026-08-26T21:00:00.000Z');
    expect(hours(draft)).toBe(24);
  });

  it('the autumn switch day, 2026-10-25, is 25 absolute hours and exactly one calendar day', () => {
    // Midnight 25.10 is still IDT (+03:00 → 21:00Z on the 24th); midnight 26.10 is IST (+02:00 → 22:00Z on the 25th).
    const draft = buildRsvpDeadlineDraft({
      ...heading,
      startIsoMidnight: '2026-10-24T21:00:00.000Z',
      endIsoMidnight: '2026-10-25T22:00:00.000Z',
    });
    expect(draft.start.toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(draft.end.toISOString()).toBe('2026-10-25T22:00:00.000Z');
    expect(hours(draft)).toBe(25);
    expect(draft.allDay).toBe(true);
    expect(draft.showAs).toBe('free');
  });

  it('the spring switch day, 2026-03-27, is 23 absolute hours and exactly one calendar day', () => {
    // Midnight 27.3 is still IST (+02:00 → 22:00Z on the 26th); midnight 28.3 is IDT (+03:00 → 21:00Z on the 27th).
    const draft = buildRsvpDeadlineDraft({
      ...heading,
      startIsoMidnight: '2026-03-26T22:00:00.000Z',
      endIsoMidnight: '2026-03-27T21:00:00.000Z',
    });
    expect(draft.start.toISOString()).toBe('2026-03-26T22:00:00.000Z');
    expect(draft.end.toISOString()).toBe('2026-03-27T21:00:00.000Z');
    expect(hours(draft)).toBe(23);
    expect(draft.allDay).toBe(true);
    expect(draft.showAs).toBe('free');
  });
});

describe('buildCancelledSubject', () => {
  it('prefixes an un-cancelled subject', () => {
    expect(buildCancelledSubject('החתונה של דנה ויוסי')).toBe('[בוטל] החתונה של דנה ויוסי');
  });

  it('is idempotent — does not double-prefix an already-cancelled subject', () => {
    const once = buildCancelledSubject('החתונה של דנה ויוסי');
    expect(buildCancelledSubject(once)).toBe(once);
  });
});

describe('buildCancelledUpdate', () => {
  it('prefixes the subject, swaps the category, and preserves start/end exactly', () => {
    const start = new Date('2026-09-01T18:00:00.000Z');
    const end = new Date('2026-09-01T22:00:00.000Z');
    const update = buildCancelledUpdate({ subject: 'החתונה של דנה ויוסי', start, end });
    expect(update.subject).toBe('[בוטל] החתונה של דנה ויוסי');
    expect(update.category).toBe(EVENT_EXCHANGE_CANCELLED_CATEGORY);
    expect(update.start).toBe(start);
    expect(update.end).toBe(end);
  });
});
