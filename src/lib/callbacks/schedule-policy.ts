// When a callback may be placed in the owner's calendar, and where the caller's
// stated preference lands on the clock.
//
// Pure and dependency-free apart from the Israel wall-clock helpers and the
// Shabbat/Yom-Tov calendar — no DB, no Exchange, no clock of its own (`nowMs`
// is always passed in). That is what makes the whole scheduling decision
// testable without a mailbox.
//
// The Shabbat/Yom-Tov engine is REUSED from the outreach send-window
// (buildJewishCalendar) rather than reimplemented. The business-hours policy is
// NOT reused: outreach windows govern messages to guests, these govern the
// owner's own working day, and conflating them would mean one screen silently
// changing the other.

import { israelCalendarDay, ilWallTimeToIso } from '@/lib/data/event-date';
import { buildJewishCalendar, type BlockedCalendar } from '@/lib/outreach/jewish-calendar';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** Owner decision 28.07: Sun–Thu 09:00–18:00, Fri 09:00–13:00, Sat closed. */
export type DayWindow = { startMin: number; endMin: number } | null;

export type CallbackPolicy = {
  /** Index 0 = Sunday … 6 = Saturday. `null` = no callbacks that day. */
  readonly weekday: readonly DayWindow[];
  /**
   * Index 0 = Sunday … 6 = Saturday. `null` = no dialing that day. Governs
   * when a call may actually be PLACED (console-calls.ts's
   * evaluateSharedConsentGates) — a separate concern from `weekday` above,
   * which only governs when a NEW callback may be scheduled onto the
   * calendar. The two happened to share the same hours before 31.8, when
   * this became independently admin-editable.
   */
  readonly dialWeekday: readonly DayWindow[];
  /** Nothing may be booked sooner than this from now. */
  readonly minNoticeMs: number;
  /** Nothing may be booked further out than this. */
  readonly horizonMs: number;
  /** Length of the appointment itself. */
  readonly durationMs: number;
  /** Ceiling on scheduled callbacks per calendar day. */
  readonly dailyCap: number;
  /** Minutes after havdalah before scheduling resumes. */
  readonly motzashResumeMs: number;
  /**
   * Ceiling on dial attempts per callback_request_id (or sales-call target)
   * within attemptWindowMs, shared by console-calls.ts, callback-request-
   * attempts.ts and sales-call-attempts.ts — all three count the same
   * CONSOLE_DIAL_AUDIT_ACTION activity_log rows against this one budget.
   */
  readonly maxAttempts: number;
  /** Rolling lookback window for counting attempts toward maxAttempts. */
  readonly attemptWindowMs: number;
};

const H = (h: number) => h * 60;

export const DEFAULT_CALLBACK_POLICY: CallbackPolicy = {
  weekday: [
    { startMin: H(9), endMin: H(18) }, // Sunday
    { startMin: H(9), endMin: H(18) },
    { startMin: H(9), endMin: H(18) },
    { startMin: H(9), endMin: H(18) },
    { startMin: H(9), endMin: H(18) }, // Thursday
    { startMin: H(9), endMin: H(13) }, // Friday
    null, // Saturday
  ],
  // Matches console-calls.ts's former HUMAN_CALL_WINDOW constant verbatim.
  dialWeekday: [
    { startMin: H(8), endMin: H(19) }, // Sunday
    { startMin: H(8), endMin: H(19) },
    { startMin: H(8), endMin: H(19) },
    { startMin: H(8), endMin: H(19) },
    { startMin: H(8), endMin: H(19) }, // Thursday
    { startMin: H(8), endMin: H(13) }, // Friday
    null, // Saturday
  ],
  minNoticeMs: 2 * 60 * MIN_MS,
  horizonMs: 14 * DAY_MS,
  durationMs: 15 * MIN_MS,
  dailyCap: 8,
  motzashResumeMs: 30 * MIN_MS,
  maxAttempts: 3,
  attemptWindowMs: 30 * DAY_MS,
};

// ── Israel wall-clock primitives ────────────────────────────────────────────
// Same approach as the outreach send-window, which keeps them private; they are
// re-derived here rather than exported from there so this module does not
// depend on that one's internals.

const HM_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function localParts(ms: number): { date: string; weekday: number; minutes: number } {
  const date = israelCalendarDay(ms);
  // A plain calendar date's weekday is timezone-independent (0=Sun … 6=Sat).
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const [h, m] = HM_FMT.format(ms).split(':').map(Number);
  return { date, weekday, minutes: h * 60 + m };
}

export function addCalendarDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The absolute instant of an Israel wall-clock date + minutes from midnight. */
export function localInstant(dateStr: string, minutes: number): number {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return Date.parse(ilWallTimeToIso(dateStr, `${hh}:${mm}`));
}

/**
 * The next instant at or after `targetMs` that falls inside `policy.weekday`'s
 * business-hours window. Used to turn "~24h before the meeting" into a legal
 * calling time for the meeting-confirmation dispatch trigger (plan §2: "אם 24
 * שעות לפני נופל מחוץ לחלון — להזיז קדימה לתחילת החלון הבא").
 *
 * Deliberately does NOT consult the Shabbat/Yom-Tov calendar
 * (buildJewishCalendar) — that engine answers "is the OWNER's calendar free",
 * a live-Exchange concern findCallbackSlot already owns; this only answers
 * "is this a plausible hour to dial at all". The actual dispatch gate
 * (evaluateSharedConsentGates, DIAL_GATE_POLICY.callback) re-checks hours
 * fresh at fire time regardless, so an imprecise clamp here (e.g. landing on
 * a weekday that happens to be a Jewish holiday) is caught there, not silently
 * acted on — this function only needs to get close, not be exhaustive.
 */
export function clampIntoCallbackWindow(
  targetMs: number,
  policy: CallbackPolicy = DEFAULT_CALLBACK_POLICY,
): number {
  let cursor = targetMs;
  // Bounded to a generous 21 days so a policy with every day closed (a config
  // error, never DEFAULT_CALLBACK_POLICY's own shape) cannot loop forever —
  // it falls through to returning the last cursor checked instead.
  for (let i = 0; i < 21; i += 1) {
    const { date, weekday, minutes } = localParts(cursor);
    const window = policy.weekday[weekday];
    if (window) {
      if (minutes < window.startMin) return localInstant(date, window.startMin);
      if (minutes <= window.endMin) return cursor;
    }
    cursor = localInstant(addCalendarDays(date, 1), 0);
  }
  return cursor;
}

// ── The caller's stated preference ──────────────────────────────────────────

/**
 * The closed list the public form offers. A closed list, not free text: the
 * server must never have to interpret "מחר בערב", and the caller must never be
 * shown a precise minute the business has not actually committed to.
 */
export const CALLBACK_PREFERENCES = ['asap', 'morning', 'afternoon', 'evening', 'exact'] as const;
export type CallbackPreference = (typeof CALLBACK_PREFERENCES)[number];

export function isCallbackPreference(value: unknown): value is CallbackPreference {
  return typeof value === 'string' && (CALLBACK_PREFERENCES as readonly string[]).includes(value);
}

/** Owner-approved band starts, in Israel wall-clock minutes. */
const BAND_START: Record<Exclude<CallbackPreference, 'asap' | 'exact'>, number> = {
  morning: H(9),
  afternoon: H(12),
  evening: H(16),
};
/**
 * How late into a band a request may still be honoured today. Past this the
 * band rolls to tomorrow, so "this morning" chosen at 11:55 does not become a
 * call five minutes later. Owner-approved cut-offs.
 */
const BAND_LAST_ENTRY: Record<Exclude<CallbackPreference, 'asap' | 'exact'>, number> = {
  morning: H(10),
  afternoon: H(14),
  evening: H(16),
};

/**
 * Turns the form choice into the instant stored in callback_requests.requested_at.
 *
 * The result is a PREFERENCE, not a booking: it is where the search starts.
 * findCallbackSlot still applies business hours, Shabbat and real calendar
 * conflicts on top, so an unreachable preference degrades to the next workable
 * slot instead of failing.
 */
export function preferenceToInstant(
  preference: CallbackPreference,
  nowMs: number,
  exactIso?: string | null,
  policy: CallbackPolicy = DEFAULT_CALLBACK_POLICY,
): number | null {
  if (preference === 'exact') {
    if (!exactIso) return null;
    const parsed = Date.parse(exactIso);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (preference === 'asap') return nowMs + policy.minNoticeMs;

  const bandStart = BAND_START[preference];
  const lastEntry = BAND_LAST_ENTRY[preference];
  const { date, minutes } = localParts(nowMs);
  // Already past the point where today's band is still worth offering → tomorrow.
  const day = minutes > lastEntry ? addCalendarDays(date, 1) : date;
  return localInstant(day, bandStart);
}

// ── Slot search ─────────────────────────────────────────────────────────────

export type BusyWindow = { start: Date; end: Date };

/**
 * What the CALLER said about when they can answer.
 *
 * Distinct from CallbackPolicy on purpose. The policy is the business's working
 * day and is ours; this is the caller's, and the two are combined by
 * INTERSECTION — never by union. A caller who says "from 08:00" does not open
 * the business an hour early, and one who says "until 22:00" does not keep it
 * open past closing. Constraints can only ever narrow the search.
 *
 * That property is what makes it safe to let an extraction step produce these:
 * the worst a wrong constraint can do is leave no slot at all, which surfaces as
 * `no_slot_within_horizon` and lands on a person — never a call at a time the
 * business does not work.
 *
 * A day window is expressed in Israel wall-clock minutes from midnight, the same
 * unit as CallbackPolicy.weekday, so the two compare directly.
 */
export type CallerConstraints = {
  /** Earliest minute of any day the caller will answer. */
  readonly notBeforeMin?: number;
  /**
   * The minute by which the call should be FINISHED — so a 15-minute call for a
   * caller reachable "until 13:00" is placed no later than 12:45.
   *
   * Deliberately the OPPOSITE rule to the business's own closing time, which
   * governs only when calls stop being STARTED. The asymmetry is the point
   * (owner decision 28.07): staying on the line past closing is a choice the
   * business makes, while 13:00 is a fact about the caller — at 13:00 they walk
   * into something. Applying our own generosity to their reality would book a
   * call they cannot take.
   *
   * This constrains where an appointment is PLACED, nothing else. A live call
   * that runs long runs long — that is ordinary phone-room behaviour and no
   * part of this system ever cuts one short.
   */
  readonly notAfterMin?: number;
  /** Israel calendar dates (YYYY-MM-DD) the caller ruled out entirely. */
  readonly excludeDates?: readonly string[];
};

const MINUTES_IN_DAY = 24 * 60;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a set of constraints is structurally usable.
 *
 * Checked rather than trusted because from stage 3 these arrive from an
 * extraction step, and a malformed constraint must fail LOUDLY. The date format
 * is the one that matters most: an out-of-range minute at least produces a
 * visibly empty window, whereas '28/07/2026' simply never matches an Israel
 * calendar day and silently schedules straight through the day the caller ruled
 * out — a wrong call, with nothing anywhere reporting a problem.
 */
export function validateConstraints(constraints: CallerConstraints): boolean {
  const inDay = (v: number | undefined) =>
    v === undefined || (Number.isInteger(v) && v >= 0 && v < MINUTES_IN_DAY);

  if (!inDay(constraints.notBeforeMin) || !inDay(constraints.notAfterMin)) return false;
  if (
    constraints.notBeforeMin !== undefined &&
    constraints.notAfterMin !== undefined &&
    constraints.notBeforeMin >= constraints.notAfterMin
  ) {
    return false;
  }
  for (const date of constraints.excludeDates ?? []) {
    if (!DATE_ONLY.test(date)) return false;
    // Catches 2026-02-31 and 2026-13-01, which match the shape but are not days.
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return false;
    }
  }
  return true;
}

/**
 * Where inside the allowed set to aim — the third layer, and the one this
 * engine was missing.
 *
 * Scheduling literature splits the problem in two: hard constraints PRUNE the
 * invalid, weighted soft preferences RANK what survives. Everything here used
 * to be pruning, so the form's time-of-day band had nowhere to live and was
 * smuggled in as the search's starting instant. That is what made it collide:
 * a caller who wrote "available 08:00-13:00" and ticked "afternoon" had a start
 * of 16:00 pushed against a window ending at 13:00, and lost the day entirely
 * (measured 28.07 — the request asked for 10.08 and would have been booked for
 * the 11th).
 *
 * As a rank it cannot collide, because it only ever chooses among instants the
 * hard constraints already approved.
 *
 *   earliest  as soon as the rules allow — the default, and what asap means
 *   early     the early end of what is allowed ("morning")
 *   late      the late end of what is allowed ("afternoon" / "evening")
 *   nearest   as close as possible to preferredMs, in EITHER direction
 *
 * 'nearest' is for a caller who named a moment — "call me on 10.08 at four".
 * The moment itself is often unavailable (a meeting, the cap, closing time),
 * and the honest answer then is the closest workable time, not the next one
 * going forward: 15:30 is nearer to four o'clock than 17:00 is, and the form
 * already promises only that we will TRY for what was chosen. This is the
 * "alternative relatively close to the customer's preferred interval" that the
 * scheduling literature treats as standard.
 */
export type SlotRank = 'earliest' | 'early' | 'late' | 'nearest';

export type SlotSearchInput = {
  /** Where to start looking — normally requested_at, else now + min notice. */
  preferredMs: number;
  nowMs: number;
  /** Busy windows from the live mailbox (provider getAvailability). */
  busy: readonly BusyWindow[];
  /** Scheduled callbacks per Israel calendar day, for the cap. */
  bookedPerDay: Readonly<Record<string, number>>;
  policy?: CallbackPolicy;
  /** The caller's own limits, intersected with the policy. */
  constraints?: CallerConstraints;
  /** Where inside the allowed set to aim. Defaults to 'earliest'. */
  rank?: SlotRank;
  /** Injectable for tests; built from the search range when omitted. */
  calendar?: BlockedCalendar;
};

/**
 * Why no slot was found. Three different problems that must not be confused:
 *
 *   invalid_constraints        — the constraints are not usable input
 *   no_slot_within_constraints — the calendar has room, the caller's window does not
 *   no_slot_within_horizon     — nothing free, constraints or not
 *
 * The distinction is not cosmetic. From stage 3 these constraints come from an
 * extraction step, and "the model produced an impossible window" is a signal
 * about the MODEL, while "the fortnight is full" is a signal about CAPACITY.
 * Reporting both as one reason would feed the improvement loop a mixture of the
 * two and make it impossible to tell whether extraction was getting better.
 */
export type SlotFailureReason =
  | 'no_slot_within_horizon'
  | 'no_slot_within_constraints'
  | 'invalid_constraints';

export type SlotResult =
  | { ok: true; startMs: number; endMs: number }
  | { ok: false; reason: SlotFailureReason };

/**
 * The first instant at/after `preferredMs` where a callback may actually be
 * placed: inside business hours, outside Shabbat/Yom-Tov, not colliding with a
 * real appointment, and on a day that has not hit the cap.
 *
 * Advances by jumping to the end of whatever blocked it, never by fixed steps —
 * so a fully booked fortnight costs a bounded number of hops, not one per minute.
 */
export function findCallbackSlot(input: SlotSearchInput): SlotResult {
  const constraints = input.constraints ?? {};
  if (!validateConstraints(constraints)) return { ok: false, reason: 'invalid_constraints' };

  const found = searchSlot(input, constraints);
  if (found.ok) return found;

  // Which of the two failures was it? Not tracked per day on purpose — a day can
  // be blocked by the calendar AND by the caller at once, and any per-day
  // bookkeeping would have to guess which "really" caused it. Asking the
  // question directly is exact: would this same search have succeeded without
  // the caller's limits? One extra pass, and only ever on the failure path.
  const stated =
    constraints.notBeforeMin !== undefined ||
    constraints.notAfterMin !== undefined ||
    (constraints.excludeDates?.length ?? 0) > 0;
  if (stated && searchSlot(input, {}).ok) {
    return { ok: false, reason: 'no_slot_within_constraints' };
  }
  return found;
}

/** The search itself, against one fixed set of constraints. */
function searchSlot(input: SlotSearchInput, constraints: CallerConstraints): SlotResult {
  const policy = input.policy ?? DEFAULT_CALLBACK_POLICY;

  // 'nearest' searches the whole of the day the caller named, not the part of
  // it after the moment they picked. Starting at the moment itself would let a
  // request for "10.08 at four" abandon the 10th the instant four o'clock does
  // not fit — the very case the rank exists for — and answer with the 11th.
  // Beginning at the day's start lets the forward pass establish that the day
  // IS workable; the ranking below then picks the instant closest to the four
  // o'clock that was actually asked for.
  const searchFrom =
    input.rank === 'nearest'
      ? localInstant(localParts(input.preferredMs).date, 0)
      : input.preferredMs;
  const earliest = Math.max(searchFrom, input.nowMs + policy.minNoticeMs);
  const deadline = input.nowMs + policy.horizonMs;
  const calendar =
    input.calendar ?? buildJewishCalendar(earliest - DAY_MS, deadline + DAY_MS);

  // Sorted once; the overlap scan below relies on the order.
  const busy = [...input.busy]
    .map((w) => ({ start: w.start.getTime(), end: w.end.getTime() }))
    .sort((a, b) => a.start - b.start);

  let t = earliest;

  // Each iteration moves t strictly forward to the end of the thing that
  // blocked it. 600 hops covers a fortnight many times over.
  for (let hop = 0; hop < 600; hop++) {
    if (t + policy.durationMs > deadline) return { ok: false, reason: 'no_slot_within_horizon' };

    // 1. Shabbat / Yom-Tov, including the post-havdalah resume gap.
    const allowed = calendar.nextAllowedAt(t, policy.motzashResumeMs);
    if (allowed > t) {
      t = allowed;
      continue;
    }

    const { date, weekday } = localParts(t);

    // 2. A day with no window at all (Saturday) → start of the next day.
    const window = policy.weekday[weekday];
    if (!window) {
      t = localInstant(addCalendarDays(date, 1), 0);
      continue;
    }

    // 2b. A day the CALLER ruled out. Checked before the clock for the same
    //     reason as the cap: skip the day whole rather than probing it.
    if (constraints.excludeDates?.includes(date)) {
      t = localInstant(addCalendarDays(date, 1), 0);
      continue;
    }

    // 3. The day's cap — checked before the clock, so a full day is skipped
    //    whole rather than probed slot by slot.
    if ((input.bookedPerDay[date] ?? 0) >= policy.dailyCap) {
      t = localInstant(addCalendarDays(date, 1), 0);
      continue;
    }

    // 4. Business hours — a SOFT edge. Closing time governs when calls stop
    //    being STARTED, not when one must be hung up: a call begun at 12:50 on
    //    a Friday that runs to 13:05 is simply a call you finished, exactly as
    //    a phone room stays on the line for the last customer (owner
    //    correction, 28.07). So only the start has to be inside the window.
    //    Shabbat below is the opposite — a hard edge, no overrun.
    //    The caller's own limits narrow this window; they never widen it, so a
    //    later opening always wins.
    const openMs = localInstant(
      date,
      Math.max(window.startMin, constraints.notBeforeMin ?? window.startMin),
    );
    const businessCloseMs = localInstant(date, window.endMin);
    // The caller's cut-off is an END, not a start (see CallerConstraints): the
    // whole appointment has to fit before it.
    const callerEndByMs =
      constraints.notAfterMin === undefined ? null : localInstant(date, constraints.notAfterMin);

    // The two can leave no usable time at all — "only before 08:00" against a
    // 09:00 opening. Not an error: a day this caller cannot be reached on. Try
    // the next one. If every day in the horizon is like this the caller ends up
    // with no_slot_within_constraints, which the caller of THIS function can
    // route to manual review.
    if (
      openMs >= businessCloseMs ||
      (callerEndByMs !== null && openMs + policy.durationMs > callerEndByMs)
    ) {
      t = localInstant(addCalendarDays(date, 1), 0);
      continue;
    }

    if (t < openMs) {
      t = openMs;
      continue;
    }
    if (t >= businessCloseMs) {
      t = localInstant(addCalendarDays(date, 1), 0);
      continue;
    }
    if (callerEndByMs !== null && t + policy.durationMs > callerEndByMs) {
      t = localInstant(addCalendarDays(date, 1), 0);
      continue;
    }

    // 5. A real appointment in the mailbox. Overlap is half-open: an item
    //    ending exactly at t does not block t.
    const clash = busy.find((w) => w.start < t + policy.durationMs && w.end > t);
    if (clash) {
      t = clash.end;
      continue;
    }

    // 6. A Shabbat/chag that STARTS mid-appointment. This is the HARD edge:
    //    unlike closing time, candle-lighting is not something you run five
    //    minutes past, so the whole appointment must clear it.
    const blockStart = calendar.nextBlockedStart(t);
    if (blockStart < t + policy.durationMs) {
      t = calendar.nextAllowedAt(blockStart, policy.motzashResumeMs);
      continue;
    }

    // ── The ranking layer ───────────────────────────────────────────────────
    // `t` is the EARLIEST usable instant, which is the whole answer for
    // 'earliest' and 'early'. For 'late' the day is now known to be workable,
    // so walk it backwards from its last plausible start and take the first
    // instant that passes the same checks. Never earlier than `t`: that bound
    // already carries the minimum notice and the caller's own opening.
    const rank = input.rank ?? 'earliest';

    // 'nearest' only means something on the day the caller actually named. If
    // the search had to leave that day — it was excluded, capped, or entirely
    // outside business hours — there is no "close" left to be, and the first
    // workable instant is already the closest the day-level rules allow.
    if (rank === 'nearest' && date === localParts(input.preferredMs).date) {
      const step = 5 * MIN_MS;
      const lastStart = Math.min(
        businessCloseMs - MIN_MS,
        callerEndByMs === null ? Number.POSITIVE_INFINITY : callerEndByMs - policy.durationMs,
      );
      let best: number | null = null;
      // Both directions, bounded below by `t` — which already carries the
      // minimum notice and the caller's own opening — and above by the last
      // legal start. Ties go to the earlier candidate, so a target exactly
      // between two free slots is answered by the sooner one.
      for (let c = Math.ceil(t / step) * step; c <= lastStart; c += step) {
        if (c >= businessCloseMs) break;
        if (callerEndByMs !== null && c + policy.durationMs > callerEndByMs) break;
        if (busy.some((w) => w.start < c + policy.durationMs && w.end > c)) continue;
        if (calendar.nextBlockedStart(c) < c + policy.durationMs) continue;
        if (
          best === null ||
          Math.abs(c - input.preferredMs) < Math.abs(best - input.preferredMs)
        ) {
          best = c;
        }
      }
      // `t` itself is always legal and may be nearer than any grid point.
      if (best === null || Math.abs(t - input.preferredMs) < Math.abs(best - input.preferredMs)) {
        best = t;
      }
      return { ok: true, startMs: best, endMs: best + policy.durationMs };
    }

    if (rank === 'late') {
      const lastStart = Math.min(
        // A start must be strictly inside business hours; one minute short of
        // closing is the last one that is.
        businessCloseMs - MIN_MS,
        callerEndByMs === null ? Number.POSITIVE_INFINITY : callerEndByMs - policy.durationMs,
      );
      // Five-minute grid: fine enough that "the late end" means it, coarse
      // enough that a nine-hour day costs ~110 probes rather than 540.
      const step = 5 * MIN_MS;
      for (let c = Math.floor(lastStart / step) * step; c > t; c -= step) {
        if (c < t) break;
        if (c >= businessCloseMs) continue;
        if (callerEndByMs !== null && c + policy.durationMs > callerEndByMs) continue;
        if (busy.some((w) => w.start < c + policy.durationMs && w.end > c)) continue;
        if (calendar.nextBlockedStart(c) < c + policy.durationMs) continue;
        return { ok: true, startMs: c, endMs: c + policy.durationMs };
      }
    }

    return { ok: true, startMs: t, endMs: t + policy.durationMs };
  }

  return { ok: false, reason: 'no_slot_within_horizon' };
}
