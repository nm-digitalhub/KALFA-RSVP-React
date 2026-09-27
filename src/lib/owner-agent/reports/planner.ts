// When is a proactive report due, and which period does it cover
// (plans/owner-agent-chat-sdk-capabilities-plan.md §4.8). PURE: no I/O, no
// `server-only` — subscriptions and an instant in, slots and windows out.
//
// ⚠️ LOCAL TIME BY FORMATTING, NOT BY OFFSET ARITHMETIC. A slot is a wall-clock
// time in the subscription's zone (Asia/Jerusalem for every row the admin
// screen writes). The planner does not compute "08:00 in UTC today"; it formats
// each of the last CATCH_UP minutes into the zone and asks whether that minute
// reads 08:00. Intl applies the zone's real rules, so:
//   - a slot inside the spring-forward gap never reads on the clock, and is not
//     sent that day (Israel switches at 02:00, where no slot is offered);
//   - a slot inside the repeated autumn hour reads twice, but both readings
//     carry the same key (local_date, slot_time), and the run table's UNIQUE
//     key keeps it to one run;
//   - midnight, the owner's 00:00 slot, always exists (the switch is at 02:00).
// src/lib/workflow/schedule.ts formats the same way but may not be imported
// here: the `owner-agent-no-client-or-ui-modules` rule fences src/lib/workflow
// off from src/lib/owner-agent.
//
// The KEY is what makes a report go out at most once: (subscription,
// local_date, slot_time), the table's unique constraint. local_date is the
// zone's calendar date of the slot, never a UTC date.

/** A due slot is planned up to this long after its minute; later it is `expired`. */
export const REPORT_CATCH_UP_MINUTES = 60;
export const REPORT_CATCH_UP_MS = REPORT_CATCH_UP_MINUTES * 60_000;

/** The one report this stage sends. */
export const DAILY_BUSINESS_REPORT = 'daily_business';

const MINUTE_MS = 60_000;
const SLOT_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface LocalParts {
  /** YYYY-MM-DD in the zone. */
  date: string;
  /** HH:MM, 24-hour, in the zone. */
  time: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The zone's calendar date and HH:MM of an instant. Throws RangeError on an unknown zone. */
export function localParts(ms: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // `hour12: false` still yields '24' for midnight in some ICU builds.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

/**
 * `HH:MM` from a stored slot: PostgREST returns a `time` column as 'HH:MM:SS'.
 * null for anything else, including a slot with seconds (the column's CHECK
 * forbids them, and a slot this code cannot read is not guessed at).
 */
export function normalizeSlotTime(value: string): string | null {
  const m = SLOT_TIME.exec(value);
  return m ? `${m[1]}:${m[2]}` : null;
}

export interface PlannerSubscription {
  id: string;
  slotTime: string;
  timezone: string;
}

export interface DueSlot {
  subscriptionId: string;
  localDate: string;
  /** HH:MM. */
  slotTime: string;
  /** Whole minutes since the slot's minute began, 0..CATCH_UP-1. */
  lateMinutes: number;
}

/**
 * Every (subscription, local date, slot) whose minute began within the last
 * REPORT_CATCH_UP_MINUTES. The tick runs every 5 minutes and inserts ON
 * CONFLICT DO NOTHING, so a slot is seen by up to twelve ticks and becomes one
 * run; a restart that misses a few ticks still catches it.
 */
export function planDueSlots(subscriptions: readonly PlannerSubscription[], nowMs: number): DueSlot[] {
  const due: DueSlot[] = [];
  for (const sub of subscriptions) {
    const slot = normalizeSlotTime(sub.slotTime);
    if (!slot) continue;
    const seen = new Set<string>();
    for (let i = 0; i < REPORT_CATCH_UP_MINUTES; i += 1) {
      let parts: LocalParts;
      try {
        parts = localParts(nowMs - i * MINUTE_MS, sub.timezone);
      } catch {
        break; // unknown zone: this subscription is never due
      }
      if (parts.time !== slot || seen.has(parts.date)) continue;
      seen.add(parts.date);
      due.push({ subscriptionId: sub.id, localDate: parts.date, slotTime: slot, lateMinutes: i });
    }
  }
  return due;
}

// The zone's offset (ms, local − UTC) at an instant, from the formatted parts.
function offsetAt(ms: number, timeZone: string): number {
  const minute = Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  const p = localParts(minute, timeZone);
  const asUtc = Date.parse(`${p.date}T${p.time}:00Z`);
  return asUtc - minute;
}

/**
 * The instant of a local wall-clock time. Two passes: guess with the offset at
 * the naive UTC reading, then correct with the offset at the result — right on
 * both sides of a switch, unlike a single probe (range.ts probes at noon and
 * is an hour off at midnight on switch days). A time inside a gap resolves to
 * an instant just past it; that slot is never planned anyway.
 */
export function wallTimeToInstant(localDate: string, time: string, timeZone: string): number {
  const slot = normalizeSlotTime(time);
  if (!LOCAL_DATE.test(localDate) || !slot) throw new Error('report_bad_slot');
  const naive = Date.parse(`${localDate}T${slot}:00Z`);
  if (Number.isNaN(naive)) throw new Error('report_bad_slot');
  const first = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(first, timeZone);
}

export interface ReportPeriod {
  sinceIso: string;
  untilIso: string;
  /** Adds the current-state lines (taken when the report is built). */
  includeSnapshot: boolean;
  /** Short Hebrew-neutral label for the header and the template's {{1}}. */
  label: string;
}

function shortDate(localDate: string): string {
  const [, m, d] = localDate.split('-');
  return `${Number(d)}.${Number(m)}`;
}

/**
 * The period a run reports on — from its KEY, never from the time it happens
 * to run, so a 00:00 report sent at 00:45 still covers the day that ended.
 *
 *   until = the slot's instant.
 *   since = local midnight of the day the period ends in (the day of until − 1ms).
 *
 * So 00:00 covers the whole local day that just ended, and 08:00 covers
 * 00:00–08:00 of the same day, plus a snapshot of the current state. Any other
 * slot covers midnight up to the slot, with a snapshot. (Plan §7 decision 3,
 * owner to confirm.)
 */
export function reportPeriod(localDate: string, slotTime: string, timeZone: string): ReportPeriod {
  const slot = normalizeSlotTime(slotTime);
  if (!slot) throw new Error('report_bad_slot');
  const until = wallTimeToInstant(localDate, slot, timeZone);
  const periodDay = localParts(until - 1, timeZone).date;
  const since = wallTimeToInstant(periodDay, '00:00', timeZone);
  const midnight = slot === '00:00';
  return {
    sinceIso: new Date(since).toISOString(),
    untilIso: new Date(until).toISOString(),
    includeSnapshot: !midnight,
    label: midnight ? shortDate(periodDay) : `${shortDate(periodDay)} 00:00–${slot}`,
  };
}
