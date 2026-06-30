// L1 — the single shared "past event" rule, as a dependency-free leaf module so
// it is safe to import from the pg-boss worker (no `server-only`) and, later, from
// client UI (e.g. disabling an RSVP button) without dragging in the events data
// layer. `@/lib/data/events` re-exports these as the documented home.
//
// An event is "past" only AFTER the end of its calendar day in Israel, matching
// the DB guard `(now() AT TIME ZONE 'Asia/Jerusalem')::date >
// (event_date AT TIME ZONE 'Asia/Jerusalem')::date`. An event TODAY is still
// valid; a null/unparseable date is never "past" (mirrors the DB NULL semantics).

const ISRAEL_TZ = 'Asia/Jerusalem';

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
