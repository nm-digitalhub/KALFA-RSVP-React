import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddToCalendar, type AddToCalendarEvent } from './add-to-calendar';
import { AddToCalendarIsland } from './add-to-calendar-island';

const base: AddToCalendarEvent = {
  name: 'האירוע של דני',
  event_type: 'birthday',
  event_date: '2026-07-12T17:30:00Z',
  venue_name: 'אולמי הגן',
  venue_address: null,
  celebrants: { name: 'דני' },
};

function ssr(event: AddToCalendarEvent) {
  return renderToStaticMarkup(createElement(AddToCalendar, { event, icsHref: '/g/abc/event.ics' }));
}

describe('<AddToCalendar /> (server)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('calendar-link');
    vi.resetModules();
  });

  it('renders nothing without an event_date', () => {
    expect(ssr({ ...base, event_date: null })).toBe('');
  });

  it('renders the button, no open menu, and a <noscript> web fallback; no inert subtree', () => {
    const html = ssr(base);
    expect(html).toContain('>הוספה ליומן</button>');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toMatch(/<noscript><a href="https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE[^"]*" target="_blank" rel="noopener noreferrer"/);
    expect(html).not.toMatch(/\binert\b/);
  });

  it('passes only hrefs to the client: the title and venue appear solely inside the generated URLs', () => {
    const html = ssr(base);
    expect(html).not.toContain('יום ההולדת של דני');
    expect(html).not.toContain('אולמי הגן');
    expect(html).toContain(encodeURIComponent('יום ההולדת של דני'));
  });

  it('NEVER-FAIL boundary: a throwing generator renders nothing and logs a redacted warning', async () => {
    vi.doMock('calendar-link', () => ({
      google: () => {
        throw new Error('boom');
      },
      outlook: () => 'x',
      office365: () => 'x',
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { AddToCalendar: Isolated } = await import('./add-to-calendar');
    const html = renderToStaticMarkup(createElement(Isolated, { event: base, icsHref: '/g/abc/event.ics' }));
    expect(html).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('[add-to-calendar] link generation failed');
    expect(warn.mock.calls[0][0]).toContain('boom');
    expect(warn.mock.calls[0][0]).not.toContain('abc'); // no token in the log line
  });
});

describe('<AddToCalendarIsland /> (server snapshot)', () => {
  const links = {
    google: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=x',
    outlookcom: 'https://outlook.live.com/calendar/0/action/compose?subject=x',
    ms365: 'https://outlook.office.com/calendar/0/action/compose?subject=x',
  };

  it('server HTML is platform-neutral: a closed dialog trigger and the noscript link only', () => {
    const html = renderToStaticMarkup(
      createElement(AddToCalendarIsland, { links, ics: { href: '/g/abc/event.ics', filename: 'x.ics' } }),
    );
    expect(html).toContain('הוספה ליומן');
    expect(html).not.toContain('/g/abc/event.ics'); // rows render only when the menu opens client-side
    expect(html).not.toContain('intent://');
    expect(html).toContain('<noscript>');
  });

  it('outline variant swaps the button classes only', () => {
    const html = renderToStaticMarkup(
      createElement(AddToCalendarIsland, { links, ics: { href: '/g/abc/event.ics', filename: 'x.ics' }, variant: 'outline' }),
    );
    expect(html).toContain('border-primary');
    expect(html).not.toContain('bg-primary ');
  });
});
