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

// --- Weekday (Israel) --------------------------------------------------------
// he-IL long weekdays all render as "יום <name>"; callers embedding the day in
// "ביום {day}" want the bare name, so the "יום " prefix is stripped.
const weekdayFmt = new Intl.DateTimeFormat(ISRAEL_LOCALE, {
  timeZone: ISRAEL_TIME_ZONE,
  weekday: 'long',
});
const WEEKDAY_PREFIX_RE = /^יום /;

/** 'ראשון' — the instant's Israel weekday, bare (no "יום " prefix). '' for invalid input. */
export function formatIsraelWeekday(value: DateInput): string {
  const ms = toMs(value);
  return ms === null ? '' : weekdayFmt.format(ms).replace(WEEKDAY_PREFIX_RE, '');
}

// --- Hebrew (Jewish) calendar date -------------------------------------------
// ICU does ALL the calendar math (Intl with calendar:'hebrew' — no hand-rolled
// algorithm); this only renders the day/year NUMBERS in traditional Hebrew
// letters (a presentation, not a computation: 27→כ״ז, 5786→תשפ״ו, with the
// טו/טז exceptions). Fixtures pinned against hebcal.com (2026-07-12 =
// כ״ז בתמוז תשפ״ו; 2026-09-12 = א׳ בתשרי תשפ״ז). Day boundary follows the Israel
// CIVIL day — no sunset adjustment (an evening event after שקיעה still gets the
// civil day's Hebrew date; sunset would need a location fix, out of scope).
const hebrewPartsFmt = new Intl.DateTimeFormat('he', {
  timeZone: ISRAEL_TIME_ZONE,
  calendar: 'hebrew',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const GEMATRIA_UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const GEMATRIA_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const GEMATRIA_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

function gematria(n: number): string {
  let s = GEMATRIA_HUNDREDS[Math.floor(n / 100)] ?? '';
  const rem = n % 100;
  // 15/16 are always written טו/טז — never spelled with י״ה/י״ו.
  if (rem === 15) s += 'טו';
  else if (rem === 16) s += 'טז';
  else s += GEMATRIA_TENS[Math.floor(rem / 10)] + GEMATRIA_UNITS[rem % 10];
  return s.length === 1 ? `${s}׳` : `${s.slice(0, -1)}״${s.slice(-1)}`;
}

/** 'כ״ז בתמוז תשפ״ו' — the instant's Hebrew (Jewish) calendar date in Israel. '' for invalid input. */
export function formatIsraelHebrewDate(value: DateInput): string {
  const ms = toMs(value);
  if (ms === null) return '';
  const parts = hebrewPartsFmt.formatToParts(ms);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';
  const day = Number(get('day'));
  const month = get('month');
  const year = Number(get('year')) % 1000;
  return `${gematria(day)} ב${month} ${gematria(year)}`;
}
