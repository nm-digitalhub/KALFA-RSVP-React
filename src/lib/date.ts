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

// --- Spoken date (TTS) -------------------------------------------------------
// A spoken-friendly Israel date for the AI-voice RSVP call's `ctx` payload:
// weekday + day + Gregorian month name (Hebrew) + bare numeric year. The year is
// left as bare digits on purpose — the VoxEngine scenario's own normalizeForSpeech
// converts "2026"→"אלפיים עשרים ושש" before the TTS voices it.
const spokenDateFmt = new Intl.DateTimeFormat(ISRAEL_LOCALE, {
  timeZone: ISRAEL_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** 'יום ראשון, 14 ביולי 2026' — spoken-friendly Israel date for TTS. '' for invalid input. */
export function formatIsraelSpokenDate(value: DateInput): string {
  const ms = toMs(value);
  return ms === null ? '' : spokenDateFmt.format(ms);
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

/**
 * Whole days from today to a Y-m-d expiry date, both read as CALENDAR DATES in
 * Asia/Jerusalem.
 *
 * Three decisions, each of which was wrong on the first attempt:
 *
 *  1. Date-only arithmetic. The API gives a date with no time; subtracting it from
 *     `Date.now()` would make "expires today" read as a fraction and floor to -1 for
 *     most of the day.
 *  2. Asia/Jerusalem explicitly, NOT the process's local zone. ExtrA is an Israeli
 *     provider and its dates are Israeli calendar dates. The first version used
 *     `now.getFullYear()/getMonth()/getDate()`, which is the SERVER's zone — correct
 *     only by luck on a machine set to Israel time, and silently off by a day on one
 *     that is not. The worker and the app need not share a timezone with the vendor.
 *  3. null for anything unparseable, never a number. An expiry we cannot read must
 *     not become "expires soon" OR "expires never" — both are claims.
 */
export function daysUntil(ymd: string | null | undefined, now: Date = new Date()): number | null {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);

  // `en-CA` renders as Y-m-d, which is the format we already have on the other side.
  const todayInIsrael = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [ty, tm, td] = todayInIsrael.split('-').map(Number);
  const today = Date.UTC(ty, tm - 1, td);

  return Math.round((target - today) / 86_400_000);
}

// --- Spoken clock & relative date (ElevenLabs TTS) ---------------------------
// The formatters ABOVE emit digits on purpose: the RSVP VoxEngine scenarios run
// their own `normalizeForSpeech` over the ctx payload before `call.say()`.
//
// ⚠️ MeetingConfirmAgent.voxengine.js has NO such normalization — it forwards
// the ctx strings straight into ElevenLabs `dynamic_variables`, and the prompt
// tells the agent to speak them verbatim. MEASURED on 2026-09-14: conversations
// conv_9301…/conv_8601… were injected with `scheduled_time_spoken` "16:03" and
// "16:18", and the agent read the digits back to a real caller.
//
// So a variable bound for that agent must arrive ALREADY spoken. These build
// the Hebrew words here, in one tested place, instead of asking an LLM to
// verbalize (guardrail 14 asked exactly that, and was ignored twice).
//
// Each carries its own preposition: "היום" and "ביום שני" cannot share one
// prefix in the template ("להיום" is not Hebrew), so the template says
// `{{scheduled_when_spoken}} {{scheduled_time_spoken}}` with no "ל"/"בשעה".

// Feminine — the counted noun is שעה / דקה.
const HE_FEM_ONES = [
  '', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר',
  'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה', 'שש עשרה',
  'שבע עשרה', 'שמונה עשרה', 'תשע עשרה',
];
// Masculine — the counted noun is יום (a day of the month).
const HE_MASC_ONES = [
  '', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה', 'עשרה',
  'אחד עשר', 'שנים עשר', 'שלושה עשר', 'ארבעה עשר', 'חמישה עשר', 'שישה עשר',
  'שבעה עשר', 'שמונה עשר', 'תשעה עשר',
];
const HE_TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים'];

/** 0–59 in Hebrew words. '' for 0 — callers decide whether zero is spoken at all. */
function heNumberWords(n: number, gender: 'f' | 'm'): string {
  const ones = gender === 'f' ? HE_FEM_ONES : HE_MASC_ONES;
  if (n < 20) return ones[n] ?? '';
  const tens = HE_TENS[Math.floor(n / 10)] ?? '';
  const rest = n % 10;
  return rest === 0 ? tens : `${tens} ו${ones[rest]}`;
}

// 2000–2099 only: every date this reaches is a scheduled callback, and a year
// outside that range means the row is corrupt — better to say nothing than to
// voice a wrong year.
function heYearWords(year: number): string {
  if (year < 2000 || year > 2099) return '';
  const rest = year - 2000;
  return rest === 0 ? 'אלפיים' : `אלפיים ${heNumberWords(rest, 'f')}`;
}

// he-IL month names, indexed 1–12 — `Intl` would return them with a "ב" already
// attached in some formats, and the day-month join here needs the bare name.
const HE_MONTHS = [
  '', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const israelPartsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ISRAEL_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

type IsraelParts = { year: number; month: number; day: number; hour: number; minute: number };

/** The instant's Israel wall-clock parts. Intl does the DST math, not us. */
function israelParts(ms: number): IsraelParts {
  const out: Record<string, number> = {};
  for (const p of israelPartsFmt.formatToParts(ms)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    // 'h23' renders midnight as 24 in some ICU versions; fold it to 0.
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
  };
}

/** The instant's Israel calendar date as 'YYYY-MM-DD' — the shape `daysUntil` takes. */
function israelYmd(ms: number): string {
  const { year, month, day } = israelParts(ms);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function partOfDay(hour24: number): string {
  if (hour24 >= 5 && hour24 < 12) return 'בבוקר';
  if (hour24 === 12) return 'בצהריים';
  if (hour24 >= 13 && hour24 < 18) return 'אחר הצהריים';
  if (hour24 >= 18 && hour24 < 22) return 'בערב';
  return 'בלילה';
}

/**
 * 'בארבע ושמונה עשרה דקות אחר הצהריים' — a clock time in Hebrew WORDS, ready to
 * be spoken as-is. Includes its own "ב" preposition. '' for invalid input.
 *
 * 15 and 30 minutes take the colloquial רבע/חצי; everything else is counted in
 * דקות, which keeps "ארבע ושלוש" from being heard as two hours.
 */
export function formatIsraelSpokenClock(value: DateInput): string {
  const ms = toMs(value);
  if (ms === null) return '';
  const { hour, minute } = israelParts(ms);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const spokenHour = `ב${heNumberWords(hour12, 'f')}`;
  const suffix = partOfDay(hour);

  if (minute === 0) return `${spokenHour} ${suffix}`;
  if (minute === 15) return `${spokenHour} ורבע ${suffix}`;
  if (minute === 30) return `${spokenHour} וחצי ${suffix}`;
  if (minute === 1) return `${spokenHour} ודקה אחת ${suffix}`;
  return `${spokenHour} ו${heNumberWords(minute, 'f')} דקות ${suffix}`;
}

/**
 * 'היום' | 'מחר' | 'מחרתיים' | 'ביום שני' | 'ביום שני, בארבעה עשר בספטמבר' —
 * a spoken date relative to NOW, carrying its own preposition. '' for invalid
 * input or for a date already in the past (a caller must not be told to expect
 * a meeting that has been and gone).
 *
 * The year is spoken only when it differs from the current one: on a callback
 * scheduled days away, "אלפיים עשרים ושש" is noise that makes a human ask what
 * the robot is talking about — which is exactly what happened on 2026-09-14.
 */
export function formatIsraelRelativeSpokenDate(value: DateInput, now: DateInput = Date.now()): string {
  const ms = toMs(value);
  const nowMs = toMs(now);
  if (ms === null || nowMs === null) return '';

  // Reuses the tested calendar-day helper above rather than a second copy of
  // the same UTC-midnight arithmetic.
  const delta = daysUntil(israelYmd(ms), new Date(nowMs));
  if (delta === null) return '';
  if (delta < 0) return '';
  if (delta === 0) return 'היום';
  if (delta === 1) return 'מחר';
  if (delta === 2) return 'מחרתיים';

  const weekday = formatIsraelWeekday(ms);
  if (delta <= 6) return `ביום ${weekday}`;

  const { year, month, day } = israelParts(ms);
  const dayWords = heNumberWords(day, 'm');
  const monthName = HE_MONTHS[month] ?? '';
  const base = `ביום ${weekday}, ב${dayWords} ב${monthName}`;
  const nowYear = israelParts(nowMs).year;
  if (year === nowYear) return base;
  const yearWords = heYearWords(year);
  return yearWords ? `${base} ${yearWords}` : base;
}
