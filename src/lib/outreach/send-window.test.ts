import { describe, expect, it } from 'vitest';

import { israelCalendarDay } from '@/lib/data/event-date';
import { DEFAULT_SEND_POLICY, type SendPolicy } from './send-policy';
import type { BlockedCalendar } from './jewish-calendar';
import {
  computeStepSlot,
  evaluateStep,
  eventDayExclusiveEndMs,
  plannedSendTime,
  resolveSendSlot,
} from './send-window';
import type { Touchpoint } from './schedule';

const HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const localHM = (ms: number) => HM.format(ms);
const localMin = (ms: number) => {
  const [h, m] = localHM(ms).split(':').map(Number);
  return h * 60 + m;
};

// A blocked-interval calendar with no hebcal dependency (isolates the window
// logic). Mirrors the real BlockedCalendar contract exactly.
function fakeCal(intervals: Array<[string, string]>): BlockedCalendar {
  const iv = intervals.map(([a, b]) => ({ start: Date.parse(a), end: Date.parse(b) }));
  return {
    isBlocked: (ms) => iv.some((i) => ms >= i.start && ms < i.end),
    nextClear: (ms) => iv.find((i) => ms >= i.start && ms < i.end)?.end ?? ms,
    nextBlockedStart: (ms) => {
      let best = Infinity;
      for (const i of iv) if (i.start >= ms && i.start < best) best = i.start;
      return best;
    },
    nextAllowedAt: (ms, delay) => {
      for (const i of iv) if (ms >= i.start && ms < i.end + delay) return i.end + delay;
      return ms;
    },
  };
}

const NO_BLOCK: BlockedCalendar = {
  isBlocked: () => false,
  nextClear: (ms) => ms,
  nextBlockedStart: () => Infinity,
  nextAllowedAt: (ms) => ms,
};
const FAR_FUTURE = Date.parse('2027-01-01T00:00:00Z');

// Summer Shabbat: Fri 2026-07-03 19:08 IDT → Sat 2026-07-04 20:30 IDT.
const shabbat = fakeCal([['2026-07-03T19:08:00+03:00', '2026-07-04T20:30:00+03:00']]);
const base = {
  nowMs: Date.parse('2026-07-01T00:00:00Z'),
  expiresAtMs: FAR_FUTURE,
  policy: DEFAULT_SEND_POLICY,
};

describe('plannedSendTime — calendar days + preferred time (not event−hours)', () => {
  it('an event at 23:00 keeps the reminder on the correct business day at 11:00', () => {
    const planned = plannedSendTime('2026-07-15T23:00:00+03:00', 7, DEFAULT_SEND_POLICY);
    expect(israelCalendarDay(planned)).toBe('2026-07-08');
    expect(localHM(planned)).toBe('11:00');
  });

  it('is DST-correct (summer +3, winter +2)', () => {
    const summer = plannedSendTime('2026-07-20T18:00:00+03:00', 0, DEFAULT_SEND_POLICY);
    const winter = plannedSendTime('2026-01-20T18:00:00+02:00', 0, DEFAULT_SEND_POLICY);
    expect(new Date(summer).getUTCHours()).toBe(8); // 11:00 IDT = 08:00Z
    expect(new Date(winter).getUTCHours()).toBe(9); // 11:00 IST = 09:00Z
  });
});

describe('resolveSendSlot — window, Shabbat, spread, expiry, idempotency', () => {
  it('a reminder planned during Shabbat is deferred to Sunday 09:00, never earlier', () => {
    const r = resolveSendSlot({
      ...base,
      plannedMs: Date.parse('2026-07-04T10:00:00+03:00'), // Sat 10:00
      calendar: shabbat,
      spreadKey: 'c:g:0',
    });
    expect(r.decision).toBe('send');
    if (r.decision !== 'send') return;
    expect(shabbat.isBlocked(r.at)).toBe(false);
    expect(israelCalendarDay(r.at)).toBe('2026-07-05'); // Sunday
    expect(localMin(r.at)).toBeGreaterThanOrEqual(540); // ≥ 09:00
    expect(localMin(r.at)).toBeLessThanOrEqual(540 + 90);
  });

  it('does NOT bypass the motzash resume delay for a time just after havdalah', () => {
    // havdalah 20:30, planned 20:40, motzashPlusMin 60 → must NOT send at 20:40.
    const r = resolveSendSlot({
      ...base,
      plannedMs: Date.parse('2026-07-04T20:40:00+03:00'),
      calendar: shabbat,
      spreadKey: 'c:g:0',
    });
    expect(r.decision).toBe('send');
    if (r.decision !== 'send') return;
    expect(israelCalendarDay(r.at)).toBe('2026-07-05'); // deferred to Sunday
    expect(r.at).not.toBe(Date.parse('2026-07-04T20:40:00+03:00'));
  });

  it('1,000 recipients deferred to the same window do NOT share a startAfter', () => {
    const ats = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const r = resolveSendSlot({
        ...base,
        plannedMs: Date.parse('2026-07-04T10:00:00+03:00'),
        calendar: shabbat,
        spreadKey: `c:g${i}:0`,
      });
      if (r.decision === 'send') {
        ats.add(r.at);
        expect(israelCalendarDay(r.at)).toBe('2026-07-05');
        expect(localMin(r.at)).toBeLessThanOrEqual(540 + 90);
      }
    }
    expect(ats.size).toBeGreaterThan(950);
  });

  it('caps the spread at the next block entry (never fans into Shabbat/chag)', () => {
    // Erev-chag on a Thursday: window [09:00,20:30] but a block opens 19:08.
    const erev = fakeCal([['2026-07-09T19:08:00+03:00', '2026-07-11T20:30:00+03:00']]);
    const blockStart = Date.parse('2026-07-09T19:08:00+03:00');
    for (let i = 0; i < 200; i++) {
      const r = resolveSendSlot({
        ...base,
        plannedMs: Date.parse('2026-07-09T18:30:00+03:00'), // Thu 18:30, 90-min spread
        calendar: erev,
        spreadKey: `c:g${i}:0`,
      });
      expect(r.decision).toBe('send');
      if (r.decision !== 'send') return;
      expect(r.at).toBeGreaterThanOrEqual(Date.parse('2026-07-09T18:30:00+03:00'));
      expect(r.at).toBeLessThan(blockStart); // spread capped BEFORE Shabbat/chag
      expect(erev.isBlocked(r.at)).toBe(false);
    }
  });

  it('treats the window close as end-EXCLUSIVE (20:30:00 and 20:30:01 both defer)', () => {
    for (const iso of ['2026-07-06T20:30:00+03:00', '2026-07-06T20:30:01+03:00']) {
      const r = resolveSendSlot({
        ...base,
        plannedMs: Date.parse(iso), // Mon 20:30 exactly / +1s
        calendar: NO_BLOCK,
        spreadKey: 'c:g:0',
      });
      expect(r.decision).toBe('send');
      if (r.decision !== 'send') return;
      expect(israelCalendarDay(r.at)).toBe('2026-07-07'); // Tuesday, not Monday 20:30
    }
  });

  it('a plain in-window planned time sends at/after it, same day', () => {
    const r = resolveSendSlot({
      ...base,
      plannedMs: Date.parse('2026-07-06T11:00:00+03:00'), // Mon 11:00
      calendar: NO_BLOCK,
      spreadKey: 'c:g:0',
    });
    expect(r.decision).toBe('send');
    if (r.decision !== 'send') return;
    expect(israelCalendarDay(r.at)).toBe('2026-07-06');
    expect(localMin(r.at)).toBeGreaterThanOrEqual(11 * 60);
  });

  it('skips as expired when the planned time is already at/after the expiry', () => {
    // expiresAt exactly equal to the planned time → skip.
    const planned = Date.parse('2026-07-06T11:00:00+03:00');
    expect(
      resolveSendSlot({
        ...base,
        plannedMs: planned,
        expiresAtMs: planned,
        calendar: NO_BLOCK,
        spreadKey: 'c:g:0',
      }),
    ).toEqual({ decision: 'skip', reason: 'expired' });
  });

  it('skips when no legal window fits before the expiry', () => {
    const r = resolveSendSlot({
      ...base,
      plannedMs: Date.parse('2026-07-04T10:00:00+03:00'), // Shabbat
      expiresAtMs: Date.parse('2026-07-04T12:00:00+03:00'), // before havdalah
      calendar: shabbat,
      spreadKey: 'c:g:0',
    });
    expect(r).toEqual({ decision: 'skip', reason: 'no_window_before_expiry' });
  });

  it('is idempotent — same inputs (and any earlier now) yield the same slot', () => {
    const input = {
      ...base,
      plannedMs: Date.parse('2026-07-04T10:00:00+03:00'),
      calendar: shabbat,
      spreadKey: 'c:g:0',
    };
    const a = resolveSendSlot(input);
    const b = resolveSendSlot({ ...input, nowMs: Date.parse('2026-06-20T00:00:00Z') });
    expect(a).toEqual(b);
  });
});

// The base===null safety properties (comprehensive coverage of the rule).
describe('resolveSendSlot — base===null (Saturday) is fail-safe', () => {
  it('defers PAST an entire Shabbat→chag continuous block, never into it', () => {
    // One continuous block spanning Fri, Sat and a Sunday chag.
    const span = fakeCal([['2026-09-11T18:00:00+03:00', '2026-09-13T19:24:00+03:00']]);
    const blockEnd = Date.parse('2026-09-13T19:24:00+03:00');
    const r = resolveSendSlot({
      ...base,
      nowMs: Date.parse('2026-09-05T00:00:00Z'),
      plannedMs: Date.parse('2026-09-12T10:00:00+03:00'), // Saturday, mid-span
      calendar: span,
      spreadKey: 'c:g:0',
    });
    expect(r.decision).toBe('send');
    if (r.decision !== 'send') return;
    expect(span.isBlocked(r.at)).toBe(false);
    expect(r.at).toBeGreaterThanOrEqual(blockEnd); // after the WHOLE chag, never inside
  });

  it('fails CLOSED (skip, no hang) on a malformed all-null policy', () => {
    const allNull = {
      ...DEFAULT_SEND_POLICY,
      weekday: Array(7).fill(null),
    } as unknown as SendPolicy;
    const r = resolveSendSlot({
      ...base,
      plannedMs: Date.parse('2026-07-06T11:00:00+03:00'),
      calendar: NO_BLOCK,
      policy: allNull,
      spreadKey: 'c:g:0',
    });
    expect(r).toEqual({ decision: 'skip', reason: 'no_window_before_expiry' });
  });
});

describe('computeStepSlot / eventDayExclusiveEndMs (worker entry points)', () => {
  it('expiry is the EXCLUSIVE next Israel midnight after the event day', () => {
    const e = eventDayExclusiveEndMs('2026-07-20T18:00:00+03:00');
    expect(israelCalendarDay(e)).toBe('2026-07-21');
    expect(localHM(e)).toBe('00:00');
  });

  it('composes plannedSendTime + resolveSendSlot for a touchpoint', () => {
    const r = computeStepSlot({
      eventDateIso: '2026-07-20T18:00:00+03:00', // Mon 2026-07-20
      daysBefore: 7,
      nowMs: Date.parse('2026-07-01T00:00:00Z'),
      policy: DEFAULT_SEND_POLICY,
      calendar: NO_BLOCK,
      campaignId: 'c',
      contactId: 'g',
      stepIndex: 0,
    });
    expect(r.decision).toBe('send');
    if (r.decision !== 'send') return;
    expect(israelCalendarDay(r.at)).toBe('2026-07-13'); // event − 7 calendar days
    expect(localMin(r.at)).toBeGreaterThanOrEqual(11 * 60); // preferred 11:00
  });

  it('a slot at 23:59:30 on the event day is too late to send (expiry is next midnight)', () => {
    // The exclusive end is 00:00 the NEXT Israel day; a 23:59:30 planned instant
    // is past every legal window that day and rolls to/after the expiry → skip.
    const expiry = eventDayExclusiveEndMs('2026-07-20T18:00:00+03:00');
    expect(israelCalendarDay(expiry)).toBe('2026-07-21');
    const r = resolveSendSlot({
      ...base,
      plannedMs: Date.parse('2026-07-20T23:59:30+03:00'),
      expiresAtMs: expiry,
      calendar: NO_BLOCK,
      spreadKey: 'c:g:0',
    });
    expect(r.decision).toBe('skip'); // no legal window before the day rolls over
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE EVALUATOR (§12 FINAL / §F). One time model (plannedSendTime +
// resolveSendSlot) → send | defer | skip{reason} | terminal{expired}. The worker
// never enqueues a step > cursor; the evaluator decides the CURSOR step.
// ─────────────────────────────────────────────────────────────────────────────
describe('evaluateStep — the single send/defer/skip/terminal evaluator', () => {
  // Chronological schedule (days_before DESCENDING = send order).
  const SCHED: Touchpoint[] = [
    { days_before: 7, channel: 'whatsapp', message_key: 'invite' },
    { days_before: 3, channel: 'whatsapp', message_key: 'reminder' },
    { days_before: 1, channel: 'whatsapp', message_key: 'final' },
  ];
  // Monday event AT 23:00 — proves the reminder never drifts to a wrong day.
  const EVENT_MON = '2026-07-20T23:00:00+03:00';

  const evalStep = (o: {
    cursorIndex: number;
    nowMs: number;
    eventDateIso?: string;
    calendar?: BlockedCalendar;
    schedule?: Touchpoint[];
  }) =>
    evaluateStep({
      schedule: o.schedule ?? SCHED,
      cursorIndex: o.cursorIndex,
      eventDateIso: o.eventDateIso ?? EVENT_MON,
      nowMs: o.nowMs,
      policy: DEFAULT_SEND_POLICY,
      calendar: o.calendar ?? NO_BLOCK,
      campaignId: 'c',
      contactId: 'g',
    });

  it('event at 23:00 → a future touchpoint DEFERS to the correct calendar day at 11:00 (never next-day drift)', () => {
    const d = evalStep({ cursorIndex: 0, nowMs: Date.parse('2026-07-01T00:00:00Z') });
    expect(d.decision).toBe('defer');
    if (d.decision !== 'defer') return;
    // event 2026-07-20 (IL) − 7 days = 2026-07-13, at the preferred 11:00 window.
    expect(israelCalendarDay(d.targetSlotMs)).toBe('2026-07-13');
    expect(localMin(d.targetSlotMs)).toBeGreaterThanOrEqual(11 * 60);
    expect(Number.isInteger(d.targetSlotMs)).toBe(true); // normalized ms
  });

  it('an overdue-but-legal same-day touchpoint SENDS now (at ≥ now; stable targetSlotMs)', () => {
    // now is AFTER the whole planned spread on the planned day → send, not defer.
    const now = Date.parse('2026-07-13T14:00:00+03:00');
    const d = evalStep({ cursorIndex: 0, nowMs: now });
    expect(d.decision).toBe('send');
    if (d.decision !== 'send') return;
    expect(d.at).toBeGreaterThanOrEqual(now); // never runs before now
    expect(israelCalendarDay(d.targetSlotMs)).toBe('2026-07-13'); // stable anchor day
  });

  it('a touchpoint planned during Shabbat DEFERS to the motzash/Sunday window, never earlier', () => {
    // event Sat 2026-07-11 − 7 days = Sat 2026-07-04 (planned lands on Shabbat).
    const d = evalStep({
      cursorIndex: 0,
      eventDateIso: '2026-07-11T20:00:00+03:00',
      nowMs: Date.parse('2026-06-25T00:00:00Z'),
      calendar: shabbat,
    });
    expect(d.decision).toBe('defer');
    if (d.decision !== 'defer') return;
    expect(shabbat.isBlocked(d.targetSlotMs)).toBe(false);
    expect(israelCalendarDay(d.targetSlotMs)).toBe('2026-07-05'); // Sunday, post-Shabbat
  });

  it('SKIPS superseded_by_later_touchpoint when the next touchpoint is already due', () => {
    // now is past the 3-day mark → the 7-day reminder is redundant; the newer covers it.
    const d = evalStep({ cursorIndex: 0, nowMs: Date.parse('2026-07-18T09:00:00+03:00') });
    expect(d).toEqual({ decision: 'skip', reason: 'superseded_by_later_touchpoint' });
  });

  it('SKIPS missed_touchpoint when overdue AND its legal slot rolls to a later IL day', () => {
    // step1 (3d) planned Fri 2026-07-17 17:30 is past the Friday 12:00 window →
    // rolls to Sunday 07-19; now = Sat 07-18 → overdue on a later day = missed.
    const d = evalStep({ cursorIndex: 1, nowMs: Date.parse('2026-07-18T12:00:00+03:00') });
    expect(d).toEqual({ decision: 'skip', reason: 'missed_touchpoint' });
  });

  it('superseded and missed are DISTINCT reasons', () => {
    const superseded = evalStep({ cursorIndex: 0, nowMs: Date.parse('2026-07-18T09:00:00+03:00') });
    const missed = evalStep({ cursorIndex: 1, nowMs: Date.parse('2026-07-18T12:00:00+03:00') });
    expect(superseded).not.toEqual(missed);
    if (superseded.decision !== 'skip' || missed.decision !== 'skip') throw new Error('both skip');
    expect(superseded.reason).not.toBe(missed.reason);
  });

  it('is TERMINAL expired once the event day has passed (now ≥ next IL midnight)', () => {
    const d = evalStep({ cursorIndex: 2, nowMs: Date.parse('2026-07-21T00:30:00+03:00') });
    expect(d).toEqual({ decision: 'terminal', reason: 'expired' });
  });

  it('uses the SAME model in winter (DST): a future touchpoint defers to 11:00 IST', () => {
    const d = evalStep({
      cursorIndex: 0,
      eventDateIso: '2026-01-20T23:00:00+02:00',
      nowMs: Date.parse('2026-01-01T00:00:00Z'),
    });
    expect(d.decision).toBe('defer');
    if (d.decision !== 'defer') return;
    expect(israelCalendarDay(d.targetSlotMs)).toBe('2026-01-13');
    // 11:00 IST = 09:00Z (winter +2) — eligibility + slot share one DST-correct model.
    expect(new Date(d.targetSlotMs).getUTCHours()).toBe(9);
  });
});
