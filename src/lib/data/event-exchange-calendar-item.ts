// What a KALFA event looks like once synced into the business's connected
// Exchange calendar (Layer 2: one-way event → Exchange sync).
//
// Pure: no DB, no EWS network call — src/lib/data/event-exchange-sync.ts is
// the DAL that loads the event/connection and calls ewsProvider with what
// this module builds. Mirrors the same split as
// src/lib/callbacks/calendar-item.ts (also pure) / callback-scheduling.ts.

import { escapeHtml } from '@/lib/callbacks/calendar-item';
import { eventHeadingFor } from '@/lib/data/celebrant-display';
import type { AppointmentDraft, AppointmentUpdate } from '@/lib/exchange-ews/types';
import type { Database, Json } from '@/lib/supabase/types';

type EventType = Database['public']['Enums']['event_type'];

/** Outlook category for a synced, still-active event (owner decision). */
export const EVENT_EXCHANGE_CATEGORY = 'KALFA — אירוע לקוח';
/** Replaces EVENT_EXCHANGE_CATEGORY once the event closes/cancels. */
export const EVENT_EXCHANGE_CANCELLED_CATEGORY = 'KALFA — בוטל';

/** 1 day before the event start (owner decision). */
export const EVENT_EXCHANGE_REMINDER_MINUTES = 24 * 60;

// events.event_date carries no end time (Layer 2 scope note): a fixed 4-hour
// block is the owner's chosen placeholder duration, not a measured guest-list
// wrap time.
const EVENT_DURATION_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const CANCELLED_PREFIX = '[בוטל] ';

type EventHeadingInput = {
  eventType: EventType;
  celebrants: Json | null;
  eventName: string;
};

/**
 * "החתונה של דנה ויוסי", or with a subtitle "ברית (ההורים: נטלי קלפה — לכבוד
 * בני)" — eventHeadingFor's title/subtitle collapsed onto the ONE line an
 * Outlook subject is. Reuses eventHeadingFor directly (never re-derives
 * celebrant name formatting).
 */
export function buildEventSubject(input: EventHeadingInput): string {
  const heading = eventHeadingFor(input.eventType, input.celebrants, input.eventName);
  return heading.subtitle ? `${heading.title} (${heading.subtitle})` : heading.title;
}

/** "מועד אחרון לאישור הגעה — {subject}". */
export function buildRsvpDeadlineSubject(input: EventHeadingInput): string {
  return `מועד אחרון לאישור הגעה — ${buildEventSubject(input)}`;
}

/**
 * The main appointment's body, as HTML: the owner's internal notes (if any)
 * verbatim, plus a deep link back to the event in KALFA. Every interpolated
 * value is HTML-escaped (escapeHtml, shared with the callback item) — notes
 * are the owner's own free text, but the same discipline applies regardless
 * of source (AppointmentDraft.bodyIsHtml's own rule).
 */
export function buildEventBody(input: { notes: string | null; detailUrl: string }): string {
  const lines: string[] = [];
  const notes = input.notes?.trim();
  if (notes) {
    lines.push(`<div>${escapeHtml(notes).replace(/\n/g, '<br>')}</div>`);
  }
  lines.push(`<div><a href="${escapeHtml(input.detailUrl)}">פתיחת האירוע ב-KALFA</a></div>`);
  return `<div dir="rtl">${lines.join('\n')}</div>`;
}

export type EventExchangeDraftInput = EventHeadingInput & {
  /** events.event_date — an ISO instant, already validated non-null by the publish gate. */
  eventDateIso: string;
  notes: string | null;
  detailUrl: string;
};

/** The main, timed appointment for the event itself. */
export function buildEventAppointmentDraft(input: EventExchangeDraftInput): AppointmentDraft {
  const start = new Date(input.eventDateIso);
  const end = new Date(start.getTime() + EVENT_DURATION_MS);
  return {
    subject: buildEventSubject(input),
    start,
    end,
    body: buildEventBody(input),
    bodyIsHtml: true,
    category: EVENT_EXCHANGE_CATEGORY,
    reminderMinutes: EVENT_EXCHANGE_REMINDER_MINUTES,
  };
}

/**
 * The separate, informational all-day item for rsvp_deadline, when the event
 * has one. `startIsoMidnight` must already be the Israel-midnight instant of
 * the deadline day (src/lib/data/event-date.ts's ilWallTimeToIso(date,
 * '00:00') — this module stays pure and does no timezone math itself).
 *
 * showAs: 'free' is NOT optional here — AppointmentDraft's own comment: an
 * informational all-day item must pass 'free' or it blacks out the owner's
 * whole day in availability reads.
 *
 * No reminder is set (owner's call left open, kept simple): the main event
 * item already carries the 1-day reminder, and this marker is read visually
 * on the calendar grid rather than alerted on.
 */
export function buildRsvpDeadlineDraft(
  input: EventHeadingInput & { startIsoMidnight: string },
): AppointmentDraft {
  const start = new Date(input.startIsoMidnight);
  const end = new Date(start.getTime() + DAY_MS);
  return {
    subject: buildRsvpDeadlineSubject(input),
    start,
    end,
    allDay: true,
    showAs: 'free',
    category: EVENT_EXCHANGE_CATEGORY,
  };
}

/** Idempotent: does not re-prefix a subject already marked cancelled. */
export function buildCancelledSubject(currentSubject: string): string {
  return currentSubject.startsWith(CANCELLED_PREFIX)
    ? currentSubject
    : `${CANCELLED_PREFIX}${currentSubject}`;
}

/**
 * Cancellation marking: prefix the subject, swap the category. Never touches
 * start/end (updateAppointment.start/end are required fields, so the caller
 * must resend the CURRENT ones — see repairBlankCallbackBodies in
 * callback-scheduling.ts for the same bind-then-resend shape) and never
 * touches the body.
 */
export function buildCancelledUpdate(current: {
  subject: string;
  start: Date;
  end: Date;
}): AppointmentUpdate {
  return {
    start: current.start,
    end: current.end,
    subject: buildCancelledSubject(current.subject),
    category: EVENT_EXCHANGE_CANCELLED_CATEGORY,
  };
}
