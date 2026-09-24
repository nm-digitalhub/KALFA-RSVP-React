// `trigger.schedule` — a workflow that starts because the clock said so.
//
// PURE. No I/O, no Supabase, no `server-only`: it takes the armed workflows and
// a moment in time and returns the runs to create, which is what makes the whole
// thing testable without a database. The reads and the enqueue live in
// `schedule-runner.ts`, the same split `trigger.ts` / `inbound.ts` already uses.
//
// ⚠️ EVERYTHING HERE IS IN ISRAEL TIME. "כל יום ב-09:00" means nine in the
// morning where the owner and the guests are, not where the server happens to
// run — and it has to keep meaning that across both DST transitions. The slot is
// therefore computed by FORMATTING the instant into Asia/Jerusalem rather than
// by arithmetic on a UTC offset, which is the one approach that does not drift
// twice a year.
import { ISRAEL_TIME_ZONE } from '@/lib/date';

import { editorDiagramSchema } from './adapter/editor-schema';
import * as scheduleDefinition from './nodes/trigger-schedule/definition';
import type { ArmedWorkflow, PlannedRun } from './trigger';

/**
 * `HH:MM`, 24-hour. The one shape a time may take in a schedule config.
 *
 * Deliberately not a cron string. A cron expression is a programmer's tool — it
 * has five fields, two of which mean different things depending on each other —
 * and an owner who mistypes one gets an automation that fires at a time nobody
 * intended, silently. A time and a set of days covers what this product actually
 * needs and cannot be got wrong in a way that still parses.
 */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Sunday is 0, matching `Date.getDay()` and Israel's own week. */
export const SCHEDULE_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type ScheduleConfig = {
  /** `HH:MM` in Israel time. */
  time: string;
  /**
   * Which days it fires on. EMPTY OR ABSENT MEANS EVERY DAY — the same
   * "unset is the widest" rule the keyword and number filters follow, so a
   * schedule saved with only a time behaves the way its author would expect.
   */
  days?: number[];
};

/**
 * The slot an instant belongs to, as `YYYY-MM-DDTHH:mm` in Israel time.
 *
 * This string IS the deduplication key, which is why it is minute-resolution and
 * why it carries the date: two ticks inside the same minute must produce the same
 * key (the sweep runs every minute and pg-boss may deliver twice), while the same
 * clock time tomorrow must produce a different one.
 *
 * ⚠️ FORMATTED, NOT COMPUTED. `Intl` applies the zone's real rules, including
 * both DST transitions. Deriving the local time by adding a fixed offset would
 * fire an hour early or late for half the year — and would do it silently, since
 * nothing downstream can tell a wrong slot from a right one.
 */
export function israelSlot(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // `hour12: false` still yields '24' for midnight in some ICU versions — the
  // classic trap. Normalised here so a midnight schedule is not silently a
  // no-op for the one minute it should fire.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** The weekday of an instant in Israel time. Sunday = 0. */
export function israelWeekday(now: Date): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: ISRAEL_TIME_ZONE,
    weekday: 'short',
  }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/**
 * Does this config fire at this instant?
 *
 * Exported for the tests, and because "why did it not fire" is the question this
 * feature will be asked most often.
 */
export function matchesSchedule(config: unknown, now: Date): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const { time, days } = config as { time?: unknown; days?: unknown };

  if (typeof time !== 'string' || !TIME_PATTERN.test(time)) return false;

  // The minute half of the slot, compared as text. No arithmetic, so no drift.
  if (israelSlot(now).slice(-5) !== time) return false;

  // Absent or empty is every day — see ScheduleConfig. A list that is present
  // but contains nothing usable is treated the same way rather than as "never":
  // a schedule that can never fire is a dead workflow that looks armed.
  const wanted = Array.isArray(days)
    ? days.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    : [];
  if (wanted.length === 0) return true;

  return wanted.includes(israelWeekday(now));
}

/**
 * Every run this tick should create.
 *
 * Mirrors `planRuns` deliberately, down to the shape of the dedupe key: one pure
 * function per trigger source, each owning its own "which workflows does this
 * event start" rule, so adding a third source never edits a second one.
 */
export function planScheduledRuns(armed: readonly ArmedWorkflow[], now: Date): PlannedRun[] {
  const slot = israelSlot(now);
  const planned: PlannedRun[] = [];

  for (const workflow of armed) {
    const parsed = editorDiagramSchema.safeParse(workflow.definition);
    if (!parsed.success) continue;

    // The CATALOGUE decides what may start a flow, never the stored JSON —
    // rule 1, same as every other trigger path. An equality rather than "is a
    // trigger": a WhatsApp trigger must not be woken by a clock.
    const trigger = parsed.data.nodes.find((n) => n.data.type === scheduleDefinition.type);
    if (!trigger) continue;

    // Exactly one trigger, the rule the adapter enforces. A diagram with two is
    // invalid and must not be reachable through either of them.
    const triggerCount = parsed.data.nodes.filter((n) =>
      n.data.type.startsWith('trigger.'),
    ).length;
    if (triggerCount !== 1) continue;

    if (!matchesSchedule(trigger.data.properties, now)) continue;

    planned.push({
      workflowId: workflow.id,
      // The workflow's own scope. A schedule attached to one event runs for it;
      // a global one carries no event, and every guest-touching node refuses
      // inside it — the same shape `trigger.webhook` produces.
      eventId: workflow.eventId,
      triggerSource: 'schedule',
      definitionSnapshot: workflow.definition,
      // THE SLOT, not the wall clock. The sweep runs every minute and pg-boss
      // may deliver a tick twice; both produce the same key and the unique index
      // turns the second into a no-op. Tomorrow's slot differs, so tomorrow runs.
      dedupeKey: `schedule:${workflow.id}:${slot}`,
      triggerPayload: {
        // No eventId and no contactId on the payload, deliberately — the run is
        // about a moment in time, not a person. `requireGuestContext` refuses
        // every guest-touching node inside it, which is the correct answer until
        // a step goes and finds guests.
        message_text: '',
        button_payload: '',
        body: { firedAt: slot },
      },
    });
  }

  return planned;
}
