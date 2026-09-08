import { createHash } from 'node:crypto';

import { google, office365, outlook, type CalendarEvent } from 'calendar-link';
import { createEvent, type DateArray, type EventAttributes } from 'ics';

import { eventHeadingFor } from '@/lib/data/celebrant-display';
import { asEventType } from '@/lib/data/event-display';
import { ilTimeInputValue, israelCalendarDay } from '@/lib/data/event-date';
import type { Json } from '@/lib/supabase/types';

// The guest "add to calendar" DOMAIN module — everything about turning an event
// row into calendar material, shared by the <AddToCalendar> component and the
// two ICS routes (/g/[token]/event.ics, /r/[token]/event.ics). Server-side.
//
// Generators (owner-approved plan, 2026-09-08): web deep links come from
// `calendar-link` (Google / Outlook.com / Microsoft 365 — the same call shape the
// pre-pivot component used), the .ics file from the `ics` package (RFC 5545
// generator; escapes text, emits UTC instants). Both are pure, synchronous and
// documented — no module-level state, so concurrent page renders and route
// hits cannot interfere (the previous generator's undocumented single-channel
// "sink" mode failed under concurrency and 500'd a live gift page). Nothing
// here hand-rolls RFC 5545 or calendar query strings.
//
// Time: `event_date` is an absolute instant (timestamptz). Links and the ICS
// carry that instant in UTC ("Z") — every calendar renders it in the guest's
// zone, which for an Israeli event is Israel time. All-day (legacy date-only
// value, stored as midnight UTC — see ilTimeInputValue) uses the ISRAEL
// calendar day via src/lib/data/event-date.ts, never string slicing. No
// duration column exists — a timed event defaults to a 3h block.
export const DEFAULT_DURATION_HOURS = 3;
const DAY_MS = 86_400_000;

export interface CalendarEventInput {
  name: string;
  event_type: string | null;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  celebrants: Json | null;
}

export interface CalendarEventBuild {
  /** Sanitized single-line title (eventHeadingFor). */
  title: string;
  /** "venue_name, venue_address" — sanitized single line, or null. */
  location: string | null;
  /** Absolute start/end instants (end = start + 3h). */
  startMs: number;
  endMs: number;
  /** false = all-day entry (legacy date-only event_date). */
  timed: boolean;
  /** Israel calendar day of the start, 'YYYY-MM-DD' (all-day entries use it). */
  israelDay: string;
  /** Download filename without the extension. */
  fileName: string;
}

// RFC 5545 §3.3.11: TEXT must not contain CONTROL characters; a raw newline in
// a title would otherwise start a new property line ("\nURL:https://…"). The
// generator escapes the rest (comma, semicolon, backslash).
export function sanitizeCalendarText(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A safe download filename from the event title: no path/quote/control
// characters, whitespace → '-', capped. Hebrew letters are kept (valid on iOS,
// Android, macOS and Windows). Callers append ".ics".
export function icsFileName(title: string): string {
  const cleaned = sanitizeCalendarText(title)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'event';
}

/**
 * Pure builder. Returns null when there is no valid event_date to anchor an
 * entry on — mirrors the null-safety of formatEventDateLine.
 */
export function buildCalendarEvent(event: CalendarEventInput): CalendarEventBuild | null {
  if (!event.event_date) return null;
  const startMs = Date.parse(event.event_date);
  if (Number.isNaN(startMs)) return null;

  const heading = eventHeadingFor(asEventType(event.event_type), event.celebrants, event.name);
  const title = sanitizeCalendarText(heading.title);
  const location = sanitizeCalendarText([event.venue_name, event.venue_address].filter(Boolean).join(', '));

  return {
    title,
    location: location || null,
    startMs,
    endMs: startMs + DEFAULT_DURATION_HOURS * 60 * 60 * 1000,
    timed: ilTimeInputValue(event.event_date) !== '',
    israelDay: israelCalendarDay(startMs),
    fileName: icsFileName(title),
  };
}

export interface CalendarWebLinks {
  /** https://calendar.google.com/calendar/render?action=TEMPLATE&… */
  google: string;
  /** https://outlook.live.com/calendar/0/action/compose?… */
  outlookcom: string;
  /** https://outlook.office.com/calendar/0/action/compose?… */
  ms365: string;
}

function toCalendarLinkEvent(build: CalendarEventBuild): CalendarEvent {
  const base = { title: build.title, ...(build.location ? { location: build.location } : {}) };
  if (build.timed) return { ...base, start: new Date(build.startMs), end: new Date(build.endMs) };
  // All-day: calendar-link formats the (UTC) start day as YYYYMMDD — feed it the
  // Israel calendar day at midnight UTC so the day is the Israel one.
  return { ...base, start: new Date(`${build.israelDay}T00:00:00Z`), allDay: true };
}

/** The three web deep links (calendar-link). Pure and synchronous. */
export function buildCalendarLinks(build: CalendarEventBuild): CalendarWebLinks {
  const ev = toCalendarLinkEvent(build);
  return { google: google(ev), outlookcom: outlook(ev), ms365: office365(ev) };
}

function dateArray(day: string): DateArray {
  const [y, m, d] = day.split('-').map(Number);
  return [y, m, d];
}

/**
 * A stable, opaque UID: the same event always yields the same UID (re-importing
 * updates instead of duplicating), derived from a one-way hash of an internal
 * seed — never a token, never the event id itself. Without a seed the generator
 * assigns a random id.
 */
export function calendarUid(seed: string): string {
  return `${createHash('sha256').update(`kalfa-calendar:${seed}`).digest('hex').slice(0, 32)}@kalfa.me`;
}

/** The RFC 5545 text via the `ics` package (UTC instants; all-day as VALUE=DATE). */
export function renderIcs(build: CalendarEventBuild, uidSeed?: string): string {
  const when: Pick<EventAttributes, 'start' | 'startInputType' | 'startOutputType' | 'endInputType' | 'endOutputType'> & {
    end: EventAttributes['start'];
  } = build.timed
    ? {
        start: build.startMs,
        end: build.endMs,
        startInputType: 'utc',
        startOutputType: 'utc',
        endInputType: 'utc',
        endOutputType: 'utc',
      }
    : { start: dateArray(build.israelDay), end: dateArray(israelCalendarDay(Date.parse(`${build.israelDay}T12:00:00Z`) + DAY_MS)) };

  const { error, value } = createEvent({
    ...when,
    title: build.title,
    ...(build.location ? { location: build.location } : {}),
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
    productId: 'kalfa.me',
    ...(uidSeed ? { uid: calendarUid(uidSeed) } : {}),
  });
  if (error || !value) throw error ?? new Error('ics generation returned no value');
  return value;
}
