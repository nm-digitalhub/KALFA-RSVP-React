// Central Israel date/time DISPLAY formatting — the single source of truth
// for the locale and time zone every user-facing date/time must use.
//
// Why explicit everywhere (MDN Intl.DateTimeFormat):
// - Omitting `timeZone` falls back to the RUNTIME's zone. Next.js renders on
//   the server AND hydrates in the browser, so an implicit zone means the two
//   can disagree (server in Israel, guest's phone abroad) → wrong dates and
//   hydration mismatches. Pinning `Asia/Jerusalem` keeps both identical and
//   DST-correct (IST +02:00 / IDT +03:00 switch automatically).
// - `hourCycle: 'h23'` forces 00:00–23:59 (never AM/PM, never "24:00").
//   NOTE: `hour12` overrides `hourCycle` — never pass both.
// - Storage stays absolute UTC (ISO ...Z / timestamptz); conversion to Israel
//   wall time happens ONLY here, at display time. The system TZ (server/env)
//   is defense-in-depth at most — never the mechanism.
//
// Wall-clock ↔ instant conversions (inputs, validation, "is past" rules) live
// in src/lib/data/event-date.ts, which imports ISRAEL_TIME_ZONE from here.

export const ISRAEL_LOCALE = 'he-IL';
export const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

type DateInput = Date | string | number;

// Module-level singletons: Intl.DateTimeFormat construction is expensive and
// these are hot on list pages (one line per event/order/activity row).
const dateTimeFmt = new Intl.DateTimeFormat(ISRAEL_LOCALE, {
  timeZone: ISRAEL_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateFmt = new Intl.DateTimeFormat(ISRAEL_LOCALE, {
  timeZone: ISRAEL_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat(ISRAEL_LOCALE, {
  timeZone: ISRAEL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// null for empty/unparseable input — formatters return '' instead of throwing
// (Intl.format throws a RangeError on an Invalid Date), so a bad DB value can
// never crash a page; call sites keep their own fallbacks ('—', 'לא הוגדר').
function toMs(value: DateInput): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** '12.07.2026, 17:30' — Israel wall clock, 24h. '' for invalid input. */
export function formatIsraelDateTime(value: DateInput): string {
  const ms = toMs(value);
  return ms === null ? '' : dateTimeFmt.format(ms);
}

/** '12.07.2026' — the instant's calendar date in Israel. '' for invalid input. */
export function formatIsraelDate(value: DateInput): string {
  const ms = toMs(value);
  return ms === null ? '' : dateFmt.format(ms);
}

/** '17:30' — Israel wall-clock time, 24h. '' for invalid input. */
export function formatIsraelTime(value: DateInput): string {
  const ms = toMs(value);
  return ms === null ? '' : timeFmt.format(ms);
}
