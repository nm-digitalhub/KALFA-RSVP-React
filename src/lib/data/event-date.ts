// L1 — the single shared "past event" rule, as a dependency-free leaf module so
// it is safe to import from the pg-boss worker (no `server-only`) and, later, from
// client UI (e.g. disabling an RSVP button) without dragging in the events data
// layer. `@/lib/data/events` re-exports these as the documented home.
//
// An event is "past" only AFTER the end of its calendar day in Israel, matching
// the DB guard `(now() AT TIME ZONE 'Asia/Jerusalem')::date >
// (event_date AT TIME ZONE 'Asia/Jerusalem')::date`. An event TODAY is still
// valid; a null/unparseable date is never "past" (mirrors the DB NULL semantics).

import { ISRAEL_TIME_ZONE } from '@/lib/date';

const ISRAEL_TZ = ISRAEL_TIME_ZONE;

// YYYY-MM-DD for an instant's calendar day in Israel (en-CA → ISO order, which
// sorts chronologically as a plain string).
function israelCalendarDay(ms: number): string {
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

// Compose an Israel WALL-CLOCK date+time into an absolute ISO instant.
// ICU supplies the UTC offset for that specific instant (DST-aware:
// +03:00 in IDT summer, +02:00 in IST winter) — no hand-rolled offset table.
// timeStr '' → the plain date string is returned unchanged (legacy date-only
// behavior: Postgres stores it as midnight UTC, displays as a date).
const IL_OFFSET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: ISRAEL_TZ,
  timeZoneName: 'longOffset',
});

export function ilWallTimeToIso(dateStr: string, timeStr: string): string {
  if (!timeStr) return dateStr;
  // Approximate instant for offset lookup (noon avoids DST-boundary edges).
  const probe = Date.parse(`${dateStr}T12:00:00Z`);
  const part = IL_OFFSET_FMT.formatToParts(probe).find(
    (x) => x.type === 'timeZoneName',
  )?.value;
  const m = part?.match(/GMT([+-]\d{2}:\d{2})/);
  const offset = m ? m[1] : '+02:00';
  return `${dateStr}T${timeStr}:00${offset}`;
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
