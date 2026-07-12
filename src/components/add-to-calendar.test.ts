import { describe, expect, it } from 'vitest';

import { buildCalendarLinks } from './add-to-calendar';

describe('buildCalendarLinks', () => {
  it('null for a missing/invalid event_date (no anchor to build links from)', () => {
    expect(
      buildCalendarLinks({
        name: 'האירוע של דני',
        event_type: 'birthday',
        event_date: null,
        venue_name: null,
        venue_address: null,
        celebrants: null,
      }),
    ).toBeNull();

    expect(
      buildCalendarLinks({
        name: 'האירוע של דני',
        event_type: 'birthday',
        event_date: 'not-a-date',
        venue_name: null,
        venue_address: null,
        celebrants: null,
      }),
    ).toBeNull();
  });

  it('google/ics carry the absolute UTC instant regardless of runtime TZ', () => {
    const links = buildCalendarLinks({
      name: 'האירוע של דני',
      event_type: 'birthday',
      event_date: '2026-07-12T17:30:00Z',
      venue_name: null,
      venue_address: null,
      celebrants: { name: 'דני' },
    });

    expect(links).not.toBeNull();
    // Start (17:30Z) and the +3h default end (20:30Z), both UTC — google's URL
    // and the .ics VEVENT always render in "Z" form (see calendar-link's
    // dateTimeUTC path), so this holds independent of the server/browser TZ.
    expect(links!.google).toContain('dates=20260712T173000Z%2F20260712T203000Z');
    expect(links!.apple).toContain('DTSTART:20260712T173000Z');
    expect(links!.apple).toContain('DTEND:20260712T203000Z');
  });

  it('title reuses eventHeadingFor (single-name possessive heading)', () => {
    const links = buildCalendarLinks({
      name: 'האירוע של אורי',
      event_type: 'bar_mitzvah',
      event_date: '2026-07-12T17:30:00Z',
      venue_name: null,
      venue_address: null,
      celebrants: { name: 'אורי' },
    });

    expect(links!.google).toContain(encodeURIComponent('בר המצווה של אורי'));
  });

  it('joins venue name + address into a single location, omitted when both are empty', () => {
    const withVenue = buildCalendarLinks({
      name: 'חתונה',
      event_type: 'wedding',
      event_date: '2026-07-12T17:30:00Z',
      venue_name: 'אולמי הגן',
      venue_address: 'הרצל 1, תל אביב',
      celebrants: null,
    });
    expect(withVenue!.google).toContain('location=');
    expect(decodeURIComponent(withVenue!.google)).toContain('אולמי הגן, הרצל 1, תל אביב');

    const withoutVenue = buildCalendarLinks({
      name: 'חתונה',
      event_type: 'wedding',
      event_date: '2026-07-12T17:30:00Z',
      venue_name: null,
      venue_address: null,
      celebrants: null,
    });
    expect(withoutVenue!.google).not.toContain('location=');
  });
});
