// The pure send-timing core (no I/O; the worker injects now/calendar/policy).
// Two responsibilities:
//   1. plannedSendTime — WHEN a touchpoint should fire: the event's Israel
//      calendar date MINUS N calendar days, at a preferred time-of-day (NOT
//      "event − N×24h", so an event at 23:00 never drifts to a wrong business
//      day).
//   2. resolveSendSlot — turn that planned instant into a legal send slot OR a
//      skip: advance out of night/Shabbat/Yom-Tov, honour an expiry, and spread
//      deterministically within the window (so a batch deferred to one window
//      opening never shares a single startAfter).
// See docs/whatsapp-send-timing-implementation-plan-2026-07-07.md.

import { createHash } from 'node:crypto';

import { israelCalendarDay, ilWallTimeToIso } from '@/lib/data/event-date';
import {
  hhmmToMin,
  preferredMinutes,
  type SendPolicy,
} from '@/lib/outreach/send-policy';
import type { BlockedCalendar } from '@/lib/outreach/jewish-calendar';
import type { Touchpoint } from '@/lib/outreach/schedule';

const MIN_MS = 60_000;

// Israel local wall-clock minutes-from-midnight of an instant (DST-correct).
const HM_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function localParts(ms: number): { date: string; weekday: number; minutes: number } {
  const date = israelCalendarDay(ms); // YYYY-MM-DD in Asia/Jerusalem
  // Weekday of a plain calendar date is tz-independent (0=Sun … 6=Sat).
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const [h, m] = HM_FMT.format(ms).split(':').map(Number);
  return { date, weekday, minutes: h * 60 + m };
}

function addDays(dateStr: string, n: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// The absolute instant of an Israel wall-clock date + minutes-from-midnight.
function localInstant(dateStr: string, minutes: number): number {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return Date.parse(ilWallTimeToIso(dateStr, `${hh}:${mm}`));
}

// event Israel date − daysBefore CALENDAR days, at the preferred time-of-day.
export function plannedSendTime(
  eventDateIso: string,
  daysBefore: number,
  policy: SendPolicy,
): number {
  const eventDate = israelCalendarDay(Date.parse(eventDateIso));
  const targetDate = addDays(eventDate, -daysBefore);
  return localInstant(targetDate, preferredMinutes(policy, daysBefore));
}

// The EXCLUSIVE end of the event's Israel calendar day — 00:00 IL of the NEXT
// day (§4.1). End-exclusive: resolveSendSlot rejects any slot at/after it, so a
// slot on the event day is legal while the day rollover is expired. DST-correct
// (localInstant routes through ilWallTimeToIso, which looks up the real offset).
export function eventDayExclusiveEndMs(eventDateIso: string): number {
  const eventDayIL = israelCalendarDay(Date.parse(eventDateIso));
  return localInstant(addDays(eventDayIL, 1), 0);
}

export type SlotResult =
  | { decision: 'send'; at: number }
  | { decision: 'skip'; reason: 'expired' | 'no_window_before_expiry' };

// Convenience for the worker: the send slot for one touchpoint. The planned
// time is deterministic (event Israel date − daysBefore days, at the preferred
// hour), so a future touchpoint's slot is stable across re-enqueues (now is
// only a floor). The expiry is the END of the event's Israel day — a reminder
// is never sent after the event has passed.
export function computeStepSlot(args: {
  eventDateIso: string;
  daysBefore: number;
  nowMs: number;
  policy: SendPolicy;
  calendar: BlockedCalendar;
  campaignId: string;
  contactId: string;
  stepIndex: number;
}): SlotResult {
  const plannedMs = plannedSendTime(args.eventDateIso, args.daysBefore, args.policy);
  const expiresAtMs = eventDayExclusiveEndMs(args.eventDateIso);
  return resolveSendSlot({
    plannedMs,
    nowMs: args.nowMs,
    expiresAtMs,
    policy: args.policy,
    calendar: args.calendar,
    spreadKey: `${args.campaignId}:${args.contactId}:${args.stepIndex}`,
  });
}

export interface SlotInput {
  plannedMs: number;
  nowMs: number;
  expiresAtMs: number;
  policy: SendPolicy;
  calendar: BlockedCalendar;
  /** stable per (campaign, contact, step) — same key ⇒ same offset (idempotent). */
  spreadKey: string;
}

// Deterministic offset within [start, min(start+span, windowEnd)] from the key.
function spreadWithin(
  startMs: number,
  windowEndMs: number,
  spanMs: number,
  key: string,
): number {
  const room = Math.max(0, Math.min(spanMs, windowEndMs - startMs));
  if (room <= 0) return startMs;
  const rand = createHash('sha1').update(key).digest().readUInt32BE(0);
  return startMs + (rand % room);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE EVALUATOR (§12.3.1 / §F). Replaces nextTouchpointIndex +
// touchpointTime: every eligibility+timing decision for the CURSOR step flows
// through ONE function over ONE time model (plannedSendTime + resolveSendSlot).
// The worker never enqueues a step > cursor; the evaluator decides what to do
// with the cursor step:
//   send     — a legal slot is at/before now → execute the send now.
//   defer    — a legal slot is in the future → re-enqueue (deferId) at that slot.
//   skip      — this touchpoint is superseded/missed/has no window before the
//               next one → advance the cursor +1 (audited) and walk on.
//   terminal — the event day has passed (or no window remains before it and no
//               later touchpoint) → exhaust the contact.
// `targetSlotMs` is normalized to an INTEGER ms (the deferId + planned_at anchor
// must be byte-stable). 'expired' is NEVER used for a passed-but-future-event
// touchpoint — that is 'missed_touchpoint' / 'superseded_by_later_touchpoint' /
// 'no_window_before_next_touchpoint'.
// ─────────────────────────────────────────────────────────────────────────────
export type StepDecision =
  | { decision: 'send'; at: number; targetSlotMs: number }
  | { decision: 'defer'; targetSlotMs: number }
  | {
      decision: 'skip';
      reason:
        | 'superseded_by_later_touchpoint'
        | 'missed_touchpoint'
        | 'no_window_before_next_touchpoint';
    }
  | { decision: 'terminal'; reason: 'expired' };

export function evaluateStep(args: {
  schedule: Touchpoint[];
  cursorIndex: number;
  eventDateIso: string;
  nowMs: number;
  policy: SendPolicy;
  calendar: BlockedCalendar;
  campaignId: string;
  contactId: string;
}): StepDecision {
  const {
    schedule,
    cursorIndex,
    eventDateIso,
    nowMs,
    policy,
    calendar,
    campaignId,
    contactId,
  } = args;

  const expiry = eventDayExclusiveEndMs(eventDateIso);
  // Event day has passed → terminal (only real 'expired'; the event is over).
  if (nowMs >= expiry) return { decision: 'terminal', reason: 'expired' };

  const tp = schedule[cursorIndex];
  // Cursor past the end / gap in the schedule → nothing left to send. The caller
  // (ensureCurrentStep) guards cursor bounds before calling, but be defensive.
  if (!tp) return { decision: 'terminal', reason: 'expired' };

  const plannedMs = plannedSendTime(eventDateIso, tp.days_before, policy);

  // Option A walks ONE step at a time, so the only "later touchpoint" that can
  // supersede the cursor is the very next index (the schedule is authored in
  // chronological send order — days_before descending).
  const nextTp = schedule[cursorIndex + 1] as Touchpoint | undefined;
  const nextPlannedMs = nextTp
    ? plannedSendTime(eventDateIso, nextTp.days_before, policy)
    : null;

  // The next touchpoint is already due → the older (current) reminder is
  // redundant; the newer one covers it. Skip + advance (never send the stale one).
  if (nextPlannedMs !== null && nextPlannedMs <= nowMs) {
    return { decision: 'skip', reason: 'superseded_by_later_touchpoint' };
  }

  // Resolve the legal slot DETERMINISTICALLY (nowMs = plannedMs, so `now` never
  // floors it). This makes `targetSlotMs` STABLE across arm sweeps — critical:
  // it is the plan-anchor `planned_at` and the deferId key, and the in-flight
  // reserve CAS compares against it. A now-floored slot would drift every sweep
  // and permanently break the reservation for an overdue "send-now" step.
  const slot = resolveSendSlot({
    plannedMs,
    nowMs: plannedMs,
    expiresAtMs: expiry,
    policy,
    calendar,
    spreadKey: `${campaignId}:${contactId}:${cursorIndex}`,
  });

  if (slot.decision === 'skip') {
    // No legal window between the planned instant and the event-day rollover. A
    // later touchpoint may still find one (its planned time is later); else done.
    if (nextTp) return { decision: 'skip', reason: 'no_window_before_next_touchpoint' };
    return { decision: 'terminal', reason: 'expired' };
  }

  const targetSlotMs = Math.round(slot.at);

  // MISSED policy (explicit): the touchpoint is OVERDUE (its planned instant is
  // already past) AND its deterministic slot falls on a LATER Israel calendar day
  // than intended → we missed its day. Skip + advance rather than silently firing
  // a "3-day" reminder on the 2-day-before day. A FUTURE planned time merely
  // nudged forward for Shabbat/night is NOT missed (it defers).
  if (
    plannedMs < nowMs &&
    israelCalendarDay(targetSlotMs) > israelCalendarDay(plannedMs)
  ) {
    return { decision: 'skip', reason: 'missed_touchpoint' };
  }

  // The slot lands at/after the next touchpoint's planned time → sending now
  // reverses the chain order → superseded.
  if (nextPlannedMs !== null && nextPlannedMs <= targetSlotMs) {
    return { decision: 'skip', reason: 'superseded_by_later_touchpoint' };
  }

  // Future legal slot → defer (a fresh deferId job fires at targetSlotMs).
  if (targetSlotMs > nowMs) return { decision: 'defer', targetSlotMs };
  // Due now (or overdue but still same-day legal) → send. `at` = the actual run
  // instant (never before now); `targetSlotMs` stays the stable identity.
  return { decision: 'send', at: Math.max(targetSlotMs, nowMs), targetSlotMs };
}

export function resolveSendSlot(input: SlotInput): SlotResult {
  const { plannedMs, nowMs, expiresAtMs, policy, calendar, spreadKey } = input;
  const cap = hhmmToMin(policy.hardCap);
  const resumeDelayMs = policy.motzashPlusMin * MIN_MS;
  let t = Math.max(plannedMs, nowMs);

  // Bounded advance (each hop moves to a later window/day; 400 covers weeks).
  for (let iter = 0; iter < 400; iter++) {
    // End-EXCLUSIVE expiry: a slot exactly at the expiry is already too late.
    if (t >= expiresAtMs) {
      return {
        decision: 'skip',
        reason: plannedMs >= expiresAtMs ? 'expired' : 'no_window_before_expiry',
      };
    }
    // Move out of a block AND out of its post-havdalah resume gap in one step
    // (so a planned time just after havdalah never bypasses motzashPlusMin).
    const allowed = calendar.nextAllowedAt(t, resumeDelayMs);
    if (allowed > t) {
      t = allowed;
      continue;
    }

    const { date, weekday } = localParts(t);
    const base = policy.weekday[weekday];
    // null is Saturday only (parseSendPolicy enforces it) → no send that day.
    if (!base) {
      t = localInstant(addDays(date, 1), 0);
      continue;
    }
    const windowStartMs = localInstant(date, hhmmToMin(base.start));
    const windowEndMs = localInstant(date, Math.min(hhmmToMin(base.end), cap));
    if (t < windowStartMs) {
      t = windowStartMs;
      continue;
    }
    // End-EXCLUSIVE window close (20:30:00 and 20:30:01 are both out).
    if (t >= windowEndMs) {
      t = localInstant(addDays(date, 1), 0);
      continue;
    }

    // Spread within [t, usableEnd): the EARLIEST of the window close, the next
    // block's entry, and the expiry — so a fan-out never lands in Shabbat/chag
    // or past the deadline.
    const usableEnd = Math.min(windowEndMs, calendar.nextBlockedStart(t), expiresAtMs);
    if (t >= usableEnd) {
      t = localInstant(addDays(date, 1), 0);
      continue;
    }
    const at = spreadWithin(t, usableEnd, policy.spreadSpanMs, spreadKey);
    if (at >= expiresAtMs) {
      return { decision: 'skip', reason: 'no_window_before_expiry' };
    }
    return { decision: 'send', at };
  }
  return { decision: 'skip', reason: 'no_window_before_expiry' };
}
