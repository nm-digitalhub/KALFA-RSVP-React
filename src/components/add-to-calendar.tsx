import { CalendarPlus } from 'lucide-react';
import { google, ics, outlook } from 'calendar-link';

import { eventHeadingFor } from '@/lib/data/celebrant-display';
import { asEventType } from '@/lib/data/event-display';
import type { Json } from '@/lib/supabase/types';

// Isomorphic (client + server) "add to calendar" links, shown to a guest after
// they confirm attendance (rsvp-form.tsx) and on the gift landing page
// (gift-landing.tsx). Iron rule: no hand-rolled RFC 5545/.ics or calendar
// query-string building — `calendar-link` generates every href below.
//
// No duration column exists on events — every event defaults to a 3h block
// (DEFAULT_DURATION_HOURS). This is a guess, not a real end time; documented
// here since it's the one non-obvious assumption in this file.
const DEFAULT_DURATION_HOURS = 3;

export interface AddToCalendarEvent {
  name: string;
  event_type: string | null;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  celebrants: Json | null;
}

export interface CalendarLinkSet {
  google: string;
  outlook: string;
  /** `data:text/calendar` URI — Apple Calendar (and any other .ics reader)
      opens this via a plain download, there is no apple.com web endpoint. */
  apple: string;
}

/**
 * Pure link-generation, split out from the component so it is unit-testable
 * without rendering JSX (this repo's vitest config runs `.test.ts` files in a
 * node environment — no jsdom). Returns null when there's no event_date to
 * anchor a calendar entry on (mirrors the null-safety of formatEventDateLine).
 */
export function buildCalendarLinks(event: AddToCalendarEvent): CalendarLinkSet | null {
  const start = event.event_date ? new Date(event.event_date) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
  const heading = eventHeadingFor(asEventType(event.event_type), event.celebrants, event.name);
  const location = [event.venue_name, event.venue_address].filter(Boolean).join(', ');

  const calendarEvent = {
    title: heading.title,
    start,
    end,
    location: location || undefined,
  };

  return {
    google: google(calendarEvent),
    outlook: outlook(calendarEvent),
    apple: ics(calendarEvent),
  };
}

const LINK_CLASS =
  'inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline';

export function AddToCalendar({ event }: { event: AddToCalendarEvent }) {
  const links = buildCalendarLinks(event);
  if (!links) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
      <a href={links.google} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        <CalendarPlus aria-hidden className="size-4" />
        Google יומן
      </a>
      <a href={links.apple} download="event.ics" className={LINK_CLASS}>
        <CalendarPlus aria-hidden className="size-4" />
        Apple
      </a>
      <a href={links.outlook} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        <CalendarPlus aria-hidden className="size-4" />
        Outlook
      </a>
    </div>
  );
}
