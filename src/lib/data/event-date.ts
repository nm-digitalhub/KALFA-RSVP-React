// L1 — the single shared "past event" rule, as a leaf module (its only imports
// are `@/lib/date` and the side-effect-free `temporal-polyfill`) so it is safe to import from the
// pg-boss worker (no `server-only`) and from client UI without dragging in the
// events data layer. `@/lib/data/events` re-exports these as the documented home.
//
// An event is "past" only AFTER the end of its calendar day in Israel, matching
// the DB guard `(now() AT TIME ZONE 'Asia/Jerusalem')::date >
// (event_date AT TIME ZONE 'Asia/Jerusalem')::date`. An event TODAY is still
// valid; a null/unparseable date is never "past" (mirrors the DB NULL semantics).

import { Temporal } from 'temporal-polyfill';

import { ISRAEL_TIME_ZONE, addCalendarDays } from '@/lib/date';

const ISRAEL_TZ = ISRAEL_TIME_ZONE;

// YYYY-MM-DD for an instant's calendar day in Israel (en-CA → ISO order, which
// sorts chronologically as a plain string). Exported for the outreach
// send-window (it needs the event's Israel calendar date to plan touchpoints).
export function israelCalendarDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

export function isPastEventDay(
  eventDate: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!eventDate) return false;
  const eventMs = Date.parse(eventDate);
  if (Number.isNaN(eventMs)) return false;
  return israelCalendarDay(nowMs) > israelCalendarDay(eventMs);
}

// Throwing form for Server Actions that surface thrown errors (approve/activate).
// Result-object / redirect / worker paths use isPastEventDay directly.
export function assertEventNotPast(
  eventDate: string | null,
  nowMs: number = Date.now(),
): void {
  if (isPastEventDay(eventDate, nowMs)) {
    throw new Error('האירוע כבר חלף — לא ניתן לבצע פעולה זו עבור אירוע שמועדו עבר');
  }
}

// Lifecycle R2/R3 — today's Israel calendar day as 'YYYY-MM-DD'. Direct compare
// basis for rsvp_deadline (a `date` column, no time component) against "today".
export function todayIL(nowMs: number = Date.now()): string {
  return israelCalendarDay(nowMs);
}

/**
 * Why an event can no longer record an RSVP, or null when it still can.
 *
 * These are submit_rsvp's THREE event-level refusals, in the RPC's own order:
 *   event_not_active — events.status <> 'active'        → RPC 'closed'
 *   past_event_day   — past calendar day in Israel      → RPC 'closed'
 *   deadline_passed  — today_IL > events.rsvp_deadline   → RPC 'deadline_passed'
 *
 * It exists so the two dial paths cannot drift apart. dispatchOutreachCall (the
 * worker) and scripts/voximplant/bridge-call.ts (the ops launcher) both reach
 * startScenarios, but the launcher bypasses the dispatcher's gates entirely —
 * which is how three bridge calls on 2026-07-21 were placed against a past
 * event, scored 100/100 on their transcripts, and wrote no RSVP at all. Both now
 * ask this one function, so a gate fixed in one path can never be missing from
 * the other.
 *
 * Pure and nowMs-injectable: the same values in must give the same answer as the
 * SQL, and that has to be testable without a database or a phone call.
 * Guest-level refusals (unknown token, impossible count) are NOT here — those
 * depend on the guest row and can only be judged by the RPC itself.
 */
export type RsvpClosedReason = 'event_not_active' | 'past_event_day' | 'deadline_passed';

export function rsvpClosedReason(
  event: {
    eventStatus: string;
    eventDate: string | null;
    /** events.rsvp_deadline — a plain 'YYYY-MM-DD' date, or null for none. */
    rsvpDeadline: string | null;
  },
  nowMs: number = Date.now(),
): RsvpClosedReason | null {
  if (event.eventStatus !== 'active') return 'event_not_active';
  if (isPastEventDay(event.eventDate, nowMs)) return 'past_event_day';
  // Strictly greater-than, mirroring the SQL: a deadline of TODAY is still open.
  if (event.rsvpDeadline !== null && todayIL(nowMs) > event.rsvpDeadline) {
    return 'deadline_passed';
  }
  return null;
}

// Lifecycle R2/R3 — "event_date must be at least tomorrow (Israel)". Unlike
// isPastEventDay (today is still valid — R4, an active event rides through its
// own day), this boundary REJECTS today too: only event_day_IL > today_IL is
// legal. Mirrors the DB trigger's `event_date <= today_il` reject condition.
export function isBeforeTomorrowIL(
  eventDate: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!eventDate) return false;
  const eventMs = Date.parse(eventDate);
  if (Number.isNaN(eventMs)) return false;
  return israelCalendarDay(eventMs) <= israelCalendarDay(nowMs);
}

// THE ONE wall-clock -> instant primitive. Every conversion of "this wall-clock time, read IN this
// zone" to a real instant goes through here, so there is exactly one place that decides what a wall
// time means across a DST switch. A previous version looked the UTC offset up at noon of the date,
// which is the wrong offset for every wall time before the 02:00 switch on the two DST days a year
// (Israel: 01:00 on the spring switch day came out as 00:00; 00:30 on the autumn one as 01:30).
//
// THE POLICY, for every IANA zone, and the same on any machine whatever its own time zone:
//   - a wall time that happens ONCE resolves to that instant;
//   - a wall time in a fall-back OVERLAP (it happens twice) resolves to the EARLIER occurrence
//     (Israel 2026-10-25 01:30 -> 22:30Z, the +03:00 one);
//   - a wall time in a spring-forward GAP (it never happens) moves FORWARD by the size of the jump
//     (Israel 2026-03-27 02:30 -> 03:30 IDT = 00:30Z; Australia/Lord_Howe jumps 30 minutes, not 60).
// That is Temporal's disambiguation 'compatible' (ECMAScript Date, RFC 5545 §3.3.5), and it is exactly what
// Temporal is asked for below — no offset is looked up or computed here.
//
// WHY NOT @date-fns/tz'S TZDate COMPONENT CONSTRUCTOR (MEASURED 2026-10-13, @date-fns/tz 1.5.0): it has no
// disambiguation option, and its zone argument does not make the result host-independent. It reads the
// components with the native Date (host zone) and corrects by the host's offset, so for an overlap the HOST
// decides (UTC+3 or more picks the first occurrence, UTC+2 or less the second), and about twenty host zones
// are an hour off even for an unambiguous time (host Europe/Athens: 2026-03-29 03:30 Israel gave 01:30Z, not
// 00:30Z). The same goes for its setters, which date-fns' addDays/addMonths use. Production was right only
// because every process declares TZ=Asia/Jerusalem. @date-fns/tz stays for what it is sound at: showing an
// instant that already exists in a zone, and date-fns arithmetic on it.
//
// Parsing and calendar validation live here, in one place:
//   YYYY-MM-DD, 'T' or a space, HH:mm, optionally :ss, optionally .S to .SSSSSSSSS — and NOTHING after it
//   (a trailing zone designator or any other text is not a wall-clock reading and is refused). The fraction is
//   kept to the millisecond (the rest is dropped, never rounded): Microsoft Graph writes seven digits
//   ("…T00:00:00.0000000") and a refused fraction would send its all-day items to the UTC fallback, a day off.
//   Month 1-12, a real day of that month, hour 0-23, minute and second 0-59 — Temporal rejects the rest
//   (30 February, 25:00, 10:61, and 24:00, which is NOT a wall-clock time: a caller that means "the end of the
//   day" says 00:00 of the next one).
//
// Total: null — never a throw — for text that is not a wall-clock datetime, a calendar or clock value that
// does not exist, or a zone Temporal cannot resolve.
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

function resolveWallClock(wall: string, zone: string): Temporal.ZonedDateTime | null {
  const m = WALL_CLOCK.exec(wall);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, fraction] = m;
  try {
    return Temporal.PlainDateTime.from(
      {
        year: +year,
        month: +month,
        day: +day,
        hour: +hour,
        minute: +minute,
        second: second === undefined ? 0 : +second,
        millisecond: fraction === undefined ? 0 : +fraction.slice(0, 3).padEnd(3, '0'),
      },
      { overflow: 'reject' },
    ).toZonedDateTime(zone, { disambiguation: 'compatible' });
  } catch {
    return null;
  }
}

// Compose an Israel WALL-CLOCK date+time into an absolute ISO instant carrying the LOCAL offset of
// that instant (DST-aware: +03:00 in IDT summer, +02:00 in IST winter), e.g. '2026-03-27T01:00:00+02:00'.
// timeStr '' → the plain date string is returned unchanged (legacy date-only
// behavior: Postgres stores it as midnight UTC, displays as a date).
// A wall clock that cannot be read or does not exist FAILS with a RangeError: this function returns a
// string, so there is no null to return, and an offset-less or guessed datetime would be stored as if it were
// real. The input boundaries (the event, thank-you and reschedule schemas) validate the date and the time
// first, so a RangeError here means a caller skipped them.
export function ilWallTimeToIso(dateStr: string, timeStr: string): string {
  if (!timeStr) return dateStr;
  const resolved = resolveWallClock(`${dateStr}T${timeStr}`, ISRAEL_TZ);
  if (!resolved) {
    throw new RangeError(`ilWallTimeToIso: not an Israel wall-clock date and time: "${dateStr}" "${timeStr}"`);
  }
  // 'YYYY-MM-DDTHH:mm:ss±HH:MM' — the same text as before; a fraction appears only when the input had one.
  return resolved.toString({ timeZoneName: 'never', calendarName: 'never', fractionalSecondDigits: 'auto' });
}

// Resolve a zone-less wall-clock datetime ("2026-10-07T06:36", seconds and a fraction optional)
// read IN `zone` to the real instant, DST included — overlap = earlier, gap = forward (see above). This is the one place that
// turns an <input type="datetime-local"> value into an instant: such a value
// carries no zone, so handing it to Postgres stores it as UTC and to Date.parse
// reads it in the host zone — a three-hour error for Israel in summer.
// It also runs inside a Zod transform, where a throw would escape safeParse — hence total (see above).
export function wallClockToDate(wall: string, zone: string): Date | null {
  const resolved = resolveWallClock(wall, zone);
  return resolved ? new Date(resolved.epochMilliseconds) : null;
}

// The IL wall-clock HH:mm of a stored event instant, for <input type="time">
// defaults. A legacy date-only value (stored midnight UTC) returns '' so the
// form doesn't show a misleading 03:00/02:00.
export function ilTimeInputValue(iso: string | null): string {
  if (!iso) return '';
  if (/T00:00:00(\.0+)?\+00(:00)?$/.test(iso) || /^\d{4}-\d{2}-\d{2}$/.test(iso) || / 00:00:00\+00$/.test(iso)) {
    return '';
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ISRAEL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

// The IL calendar day of a stored value as 'YYYY-MM-DD', for
// <input type="date"> defaults. Correct for BOTH a full timestamptz instant
// (an event at 01:00 IDT is 22:00Z the PREVIOUS day — slicing the ISO string
// would show the wrong date) and a plain date column (returned unchanged).
export function ilDateInputValue(value: string | null): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return israelCalendarDay(ms);
}

// Auto-thankyou default schedule: 10:00 Israel on the CALENDAR day after the event's Israel calendar
// day (a reader-active hour, not the middle of the night). This is the rule the database trigger
// sync_campaign_window_from_event applies:
//   ((event_date AT TIME ZONE 'Asia/Jerusalem')::date + 1 + time '10:00') AT TIME ZONE 'Asia/Jerusalem'
// so the day is added to the DATE — never 24h to the instant, which is a day off around the two DST
// switches (a day there is 23 or 25 hours) — and the wall time is turned into an instant by the
// primitive above. Returns null for an unparseable/missing event_date (the caller must decide
// what "no schedule yet" means; this never guesses).
export function defaultThankyouSendAt(eventDate: string | null): string | null {
  if (!eventDate) return null;
  const eventMs = Date.parse(eventDate);
  if (Number.isNaN(eventMs)) return null;
  const nextDay = addCalendarDays(israelCalendarDay(eventMs), 1);
  return nextDay === null ? null : ilWallTimeToIso(nextDay, '10:00');
}
