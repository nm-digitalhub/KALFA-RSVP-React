import {
  buildCalendarEvent,
  buildCalendarLinks,
  type CalendarEventInput,
  type CalendarWebLinks,
} from '@/lib/calendar/event-calendar';

import { AddToCalendarIsland } from './add-to-calendar-island';

// THE "add to calendar" control for guests — one component, two call sites:
// the gift card's back face (g/[token]/gift-landing.tsx, a Server Component)
// and the RSVP success box (r/[token]/rsvp-form.tsx, which receives the
// rendered element from its page as the `calendar` prop, because the link
// generation below is server-side).
//
// Division of labour:
//   server (here + src/lib/calendar) — event config, the three web deep links
//   (calendar-link) and, in the ICS routes, the .ics file (`ics`);
//   client (AddToCalendarIsland) — KALFA's own button + bottom-sheet menu whose
//   rows carry the best hand-off each platform supports: the Android intent
//   that opens the Google Calendar APP, the inline https ICS that iOS Safari
//   opens as the Calendar preview, plain downloads elsewhere.
// The island receives ready-made hrefs only — no event data, no tokens beyond
// the ICS path the page already exposes.
//
// NEVER-FAIL BOUNDARY: this control is an extra. If anything in the generation
// throws, the page renders WITHOUT the calendar menu (a redacted warning is
// logged — no token, no guest data) — the payment CTA / RSVP form must never
// go down with it (live incident 2026-09-08: a generator race 500'd a wedding's
// gift page).
export type AddToCalendarEvent = CalendarEventInput;

export type AddToCalendarVariant = 'primary' | 'outline';

/** Config + links, or null (no date, or a generation failure — logged). */
export function safeCalendarLinks(
  event: AddToCalendarEvent,
): { links: CalendarWebLinks; fileName: string } | null {
  try {
    const built = buildCalendarEvent(event);
    if (!built) return null;
    return { links: buildCalendarLinks(built), fileName: built.fileName };
  } catch (err) {
    console.warn(
      `[add-to-calendar] link generation failed, rendering without the menu: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
    return null;
  }
}

export function AddToCalendar({
  event,
  icsHref,
  variant = 'primary',
  className,
}: {
  event: AddToCalendarEvent;
  /** Same-origin path of the token-gated ICS route (`/g/<token>/event.ics`). */
  icsHref: string;
  /** `outline` where the page already has one primary CTA (the gift card). */
  variant?: AddToCalendarVariant;
  className?: string;
}) {
  const built = safeCalendarLinks(event);
  if (!built) return null;

  return (
    <AddToCalendarIsland
      links={built.links}
      ics={{ href: icsHref, filename: `${built.fileName}.ics` }}
      variant={variant}
      className={className}
    />
  );
}
