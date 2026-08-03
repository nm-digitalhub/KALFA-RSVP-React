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
  it('is an all-day, free-showing item spanning exactly one day', () => {
    const draft = buildRsvpDeadlineDraft({
      eventType: 'wedding',
      celebrants: { groom: 'יוסי', bride: 'דנה' },
      eventName: 'האירוע שלנו',
      startIsoMidnight: '2026-08-25T21:00:00.000+00:00', // Israel midnight (IDT, +03:00) for 2026-08-26
    });
    expect(draft.allDay).toBe(true);
    expect(draft.showAs).toBe('free');
    expect(draft.category).toBe(EVENT_EXCHANGE_CATEGORY);
    expect(draft.end.getTime() - draft.start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(draft.reminderMinutes).toBeUndefined();
    expect(draft.subject).toContain('מועד אחרון לאישור הגעה');
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
