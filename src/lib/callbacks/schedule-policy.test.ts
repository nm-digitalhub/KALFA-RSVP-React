import { describe, expect, it } from 'vitest';

import {
  clampIntoCallbackWindow,
  DEFAULT_CALLBACK_POLICY,
  findCallbackSlot,
  localInstant,
  localParts,
  preferenceToInstant,
  validateConstraints,
  type BusyWindow,
} from './schedule-policy';

// Israel wall-clock helper so the expectations read as the owner stated them
// ("Sunday 09:00") rather than as epoch arithmetic.
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return localInstant(date, h * 60 + m);
};
const hhmm = (ms: number) => {
  const { minutes } = localParts(ms);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
const day = (ms: number) => localParts(ms).date;

// 2026-07-28 is a Tuesday; 2026-07-31 a Friday; 2026-08-01 a Saturday.
const TUE = '2026-07-28';
const FRI = '2026-07-31';
const SAT = '2026-08-01';
const SUN = '2026-08-02';

const busy = (date: string, from: string, to: string): BusyWindow => ({
  start: new Date(at(date, from)),
  end: new Date(at(date, to)),
});

describe('preferenceToInstant', () => {
  it('asap starts at now plus the minimum notice, never sooner', () => {
    const now = at(TUE, '10:00');
    expect(preferenceToInstant('asap', now)).toBe(now + DEFAULT_CALLBACK_POLICY.minNoticeMs);
  });

  it('a band chosen early in the day lands on that band today', () => {
    const got = preferenceToInstant('afternoon', at(TUE, '09:30'));
    expect(day(got!)).toBe(TUE);
    expect(hhmm(got!)).toBe('12:00');
  });

  it('a band whose entry window has passed rolls to tomorrow', () => {
    // 14:00 is the last entry for "afternoon"; 14:31 is past it.
    const got = preferenceToInstant('afternoon', at(TUE, '14:31'));
    expect(day(got!)).toBe('2026-07-29');
    expect(hhmm(got!)).toBe('12:00');
  });

  it('"this morning" chosen at 11:55 does not become a call minutes later', () => {
    const got = preferenceToInstant('morning', at(TUE, '11:55'));
    expect(day(got!)).toBe('2026-07-29');
  });

  it('exact returns the chosen instant, and null when it is unusable', () => {
    const iso = new Date(at(TUE, '16:30')).toISOString();
    expect(preferenceToInstant('exact', at(TUE, '09:00'), iso)).toBe(at(TUE, '16:30'));
    expect(preferenceToInstant('exact', at(TUE, '09:00'), null)).toBeNull();
    expect(preferenceToInstant('exact', at(TUE, '09:00'), 'not a date')).toBeNull();
  });
});

describe('findCallbackSlot', () => {
  const base = { busy: [] as BusyWindow[], bookedPerDay: {} as Record<string, number> };

  it('honours the preference when the slot is genuinely free', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '14:00'),
      nowMs: at(TUE, '09:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(hhmm(got.startMs)).toBe('14:00');
      expect(got.endMs - got.startMs).toBe(15 * 60_000);
    }
  });

  it('never books inside the minimum-notice guard', () => {
    const now = at(TUE, '10:00');
    const got = findCallbackSlot({ ...base, preferredMs: now, nowMs: now });
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.startMs).toBeGreaterThanOrEqual(now + DEFAULT_CALLBACK_POLICY.minNoticeMs);
  });

  it('moves to the end of a colliding appointment rather than overlapping it', () => {
    const got = findCallbackSlot({
      ...base,
      busy: [busy(TUE, '14:00', '14:40')],
      preferredMs: at(TUE, '14:00'),
      nowMs: at(TUE, '09:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('14:40');
  });

  it('treats an appointment ending exactly at the slot as not blocking', () => {
    const got = findCallbackSlot({
      ...base,
      busy: [busy(TUE, '13:00', '14:00')],
      preferredMs: at(TUE, '14:00'),
      nowMs: at(TUE, '09:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('14:00');
  });

  it('lets a call run past closing time — you finish with the customer', () => {
    // Friday closes at 13:00. Starting at 12:50 means hanging up at 13:05, which
    // is a call you finished, not a policy breach (owner correction 28.07).
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(FRI, '12:50'),
      nowMs: at(FRI, '08:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe(FRI);
      expect(hhmm(got.startMs)).toBe('12:50');
      expect(got.endMs).toBeGreaterThan(at(FRI, '13:00'));
    }
  });

  it('still refuses to START a call after closing time', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(FRI, '13:00'),
      nowMs: at(FRI, '08:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(day(got.startMs)).not.toBe(FRI);
  });

  it('never lands on Saturday', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(SAT, '10:00'),
      nowMs: at(FRI, '08:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(localParts(got.startMs).weekday).not.toBe(6);
      expect(day(got.startMs)).toBe(SUN);
    }
  });

  it('skips a day that has reached the cap, without probing it slot by slot', () => {
    const got = findCallbackSlot({
      ...base,
      bookedPerDay: { [TUE]: DEFAULT_CALLBACK_POLICY.dailyCap },
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '07:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(day(got.startMs)).toBe('2026-07-29');
  });

  it('opens at the start of business hours when asked for earlier', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '06:00'),
      nowMs: at('2026-07-27', '20:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('09:00');
  });

  it('gives up rather than booking past the horizon', () => {
    // Every day at the cap for well past the 14-day horizon.
    const bookedPerDay: Record<string, number> = {};
    for (let i = 0; i < 40; i++) {
      const d = new Date(at(TUE, '09:00') + i * 86_400_000);
      bookedPerDay[localParts(d.getTime()).date] = DEFAULT_CALLBACK_POLICY.dailyCap;
    }
    const got = findCallbackSlot({
      ...base,
      bookedPerDay,
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '07:00'),
    });
    expect(got).toEqual({ ok: false, reason: 'no_slot_within_horizon' });
  });

  it('treats candle-lighting as a HARD edge, unlike closing time', () => {
    // A synthetic calendar whose block opens at 12:55 on the Friday. Closing
    // time may be overrun; this may not — so the slot must move past havdalah
    // rather than start at 12:50 and run into it.
    const blockStart = at(FRI, '12:55');
    const blockEnd = at(SAT, '20:30');
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(FRI, '12:50'),
      nowMs: at(FRI, '08:00'),
      calendar: {
        isBlocked: (ms) => ms >= blockStart && ms < blockEnd,
        nextClear: (ms) => (ms >= blockStart && ms < blockEnd ? blockEnd : ms),
        nextBlockedStart: (ms) => (ms < blockStart ? blockStart : Infinity),
        nextAllowedAt: (ms, resumeMs) =>
          ms >= blockStart && ms < blockEnd + resumeMs ? blockEnd + resumeMs : ms,
      },
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.startMs).toBeGreaterThanOrEqual(blockEnd);
      expect(day(got.startMs)).toBe(SUN);
    }
  });
});

// The caller's own limits. Added after a live failure on 28.07.2026: a caller
// wrote that she was reachable 08:00–13:00 and NOT today, and was booked for
// 14:25 that same afternoon — the prose said so, and nothing that picks a time
// could read it. These tests pin the engine side of the fix; whether a note is
// ever turned into constraints is a separate question, and deliberately so.
describe('findCallbackSlot with caller constraints', () => {
  const base = { busy: [] as BusyWindow[], bookedPerDay: {} as Record<string, number> };

  // 2026-07-29 is the Wednesday after TUE.
  const WED = '2026-07-29';

  it('the live case: "08:00–13:00, not today" lands the next morning', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '12:25'),
      nowMs: at(TUE, '12:25'),
      constraints: { notBeforeMin: 8 * 60, notAfterMin: 13 * 60, excludeDates: [TUE] },
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe(WED);
      // 09:00, not 08:00: the caller's window is INTERSECTED with the business
      // day, so being reachable earlier does not open the business earlier.
      expect(hhmm(got.startMs)).toBe('09:00');
    }
  });

  it('a caller reachable only from the afternoon is not rung in the morning', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '06:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { notBeforeMin: 16 * 60 },
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe(TUE);
      expect(hhmm(got.startMs)).toBe('16:00');
    }
  });

  it('never widens the business day, however early the caller is available', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '05:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { notBeforeMin: 5 * 60 },
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('09:00');
  });

  it('stops STARTING calls after the caller\'s cut-off, and rolls to the next day', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '14:00'),
      nowMs: at(TUE, '11:00'),
      constraints: { notAfterMin: 13 * 60 },
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe(WED);
      expect(hhmm(got.startMs)).toBe('09:00');
    }
  });

  it('skips an excluded day whole rather than probing it', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { excludeDates: [TUE, WED] },
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(day(got.startMs)).toBe('2026-07-30');
  });

  it('says the CALLER was impossible, not that the calendar was full', () => {
    // Reachable only 20:00–22:00 — outside the business day every day of the
    // horizon. The calendar here is completely empty, so reporting
    // "no_slot_within_horizon" would blame capacity for what is really an
    // unusable window. From stage 3 that difference is the whole quality signal.
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '08:00'),
      constraints: { notBeforeMin: 20 * 60, notAfterMin: 22 * 60 },
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBe('no_slot_within_constraints');
  });

  it('still blames the horizon when the calendar really is the problem', () => {
    const bookedPerDay: Record<string, number> = {};
    for (let i = 0; i < 40; i++) {
      const d = new Date(at(TUE, '09:00') + i * 86_400_000);
      bookedPerDay[localParts(d.getTime()).date] = DEFAULT_CALLBACK_POLICY.dailyCap;
    }
    const got = findCallbackSlot({
      ...base,
      bookedPerDay,
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '08:00'),
      constraints: { notBeforeMin: 9 * 60, notAfterMin: 18 * 60 },
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBe('no_slot_within_horizon');
  });

  it('still refuses a Saturday, and lands on the exact slot it should', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(SAT, '10:00'),
      nowMs: at(FRI, '08:00'),
      constraints: { notBeforeMin: 9 * 60, notAfterMin: 18 * 60 },
    });
    expect(got.ok).toBe(true);
    // Saturday is blocked; havdalah plus the resume gap still falls on a day
    // with no window, so the first workable minute is Sunday's opening.
    if (got.ok) {
      expect(day(got.startMs)).toBe(SUN);
      expect(hhmm(got.startMs)).toBe('09:00');
    }
  });

  it('behaves exactly as before when no constraints are given', () => {
    const withNone = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '06:00'),
      nowMs: at('2026-07-27', '20:00'),
    });
    const withEmpty = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '06:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: {},
    });
    expect(withNone).toEqual(withEmpty);
  });
});

// The decision behind notAfterMin, pinned so nobody "simplifies" it back into
// the business-hours rule. Owner decision 28.07: a caller reachable "until
// 13:00" gets a call that ENDS by 13:00 — 13:00 is a fact about them, not a
// closing time we may generously overrun. A live call that runs long is
// ordinary and untouched by any of this; only PLACEMENT is constrained.
describe('the caller cut-off is an end, not a start', () => {
  const base = { busy: [] as BusyWindow[], bookedPerDay: {} as Record<string, number> };
  const WED = '2026-07-29';

  it('keeps a slot that finishes before the cut-off', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '12:40'),
      nowMs: at(TUE, '09:00'),
      constraints: { notAfterMin: 13 * 60 },
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      // The search never moves BACKWARDS to pack against the cut-off; 12:40 is
      // simply fine, because 12:55 is inside what the caller said.
      expect(hhmm(got.startMs)).toBe('12:40');
      expect(hhmm(got.endMs)).toBe('12:55');
    }
  });

  it('refuses 12:46, which would have talked past what the caller said', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '12:46'),
      nowMs: at(TUE, '09:00'),
      constraints: { notAfterMin: 13 * 60 },
    });
    expect(got.ok).toBe(true);
    // Not 12:46 with a 13:01 finish — the next day inside the window instead.
    if (got.ok) {
      expect(day(got.startMs)).toBe(WED);
      expect(hhmm(got.startMs)).toBe('09:00');
    }
  });

  it('keeps the OPPOSITE rule for the business closing time', () => {
    // Thursday closes at 18:00; a call may still START at 17:55 and run over,
    // because staying on the line is the business's own choice.
    const THU = '2026-07-30';
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(THU, '17:55'),
      nowMs: at(THU, '09:00'),
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(hhmm(got.startMs)).toBe('17:55');
      expect(hhmm(got.endMs)).toBe('18:10');
    }
  });
});

describe('constraint boundaries', () => {
  const base = { busy: [] as BusyWindow[], bookedPerDay: {} as Record<string, number> };
  const WED = '2026-07-29';

  it('notBefore exactly at opening changes nothing', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '06:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { notBeforeMin: 9 * 60 },
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('09:00');
  });

  it('notAfter exactly at opening leaves no room for the call itself', () => {
    // Opening 09:00 and "finish by 09:00" cannot both hold for a 15-minute
    // call — on any day. The caller's window is the cause, not the calendar.
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '06:00'),
      constraints: { notAfterMin: 9 * 60 },
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBe('no_slot_within_constraints');
  });

  it('notAfter exactly at closing behaves as if it were not given', () => {
    const withCutOff = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '06:00'),
      constraints: { notAfterMin: 18 * 60 },
    });
    const without = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '06:00'),
    });
    expect(withCutOff).toEqual(without);
  });

  it('accepts a preference landing exactly on the last usable start', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '12:45'),
      nowMs: at(TUE, '09:00'),
      constraints: { notAfterMin: 13 * 60 },
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('12:45');
  });

  it('takes the slot freed by an appointment ending exactly on the last start', () => {
    const got = findCallbackSlot({
      ...base,
      busy: [busy(TUE, '10:00', '12:45')],
      preferredMs: at(TUE, '10:00'),
      nowMs: at(TUE, '07:00'),
      constraints: { notAfterMin: 13 * 60 },
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('12:45');
  });

  it('reports the caller when every day in the horizon is excluded', () => {
    const excludeDates: string[] = [];
    for (let i = 0; i < 40; i++) {
      excludeDates.push(localParts(at(TUE, '09:00') + i * 86_400_000).date);
    }
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '07:00'),
      constraints: { excludeDates },
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBe('no_slot_within_constraints');
  });

  it('ignores duplicates in the excluded list', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { excludeDates: [TUE, TUE, TUE] },
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe(WED);
      expect(hhmm(got.startMs)).toBe('09:00');
    }
  });

  it('keeps wall-clock arithmetic correct across the end of summer time', () => {
    // Israel leaves summer time on the last Sunday of October — 2026-10-25, a
    // Sunday and a working day. Excluding it must land on the Monday AFTER the
    // clocks change, at 09:00 local: if the arithmetic were done in fixed
    // 24-hour steps instead of wall-clock days this would drift by an hour.
    const got = findCallbackSlot({
      ...base,
      preferredMs: at('2026-10-25', '09:00'),
      nowMs: at('2026-10-22', '09:00'),
      constraints: { excludeDates: ['2026-10-25'] },
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe('2026-10-26');
      expect(hhmm(got.startMs)).toBe('09:00');
    }
  });
});

// Structural checks on the constraints themselves. These matter most from
// stage 3, where the values arrive from an extraction step rather than from a
// form — garbage must be REJECTED, not reinterpreted as an empty window.
describe('validateConstraints', () => {
  it('accepts a well-formed set, and an empty one', () => {
    expect(validateConstraints({})).toBe(true);
    expect(
      validateConstraints({
        notBeforeMin: 8 * 60,
        notAfterMin: 13 * 60,
        excludeDates: ['2026-07-28'],
      }),
    ).toBe(true);
  });

  it('rejects minutes outside a day', () => {
    expect(validateConstraints({ notBeforeMin: -100 })).toBe(false);
    expect(validateConstraints({ notAfterMin: 9000 })).toBe(false);
    expect(validateConstraints({ notAfterMin: 1440 })).toBe(false);
    expect(validateConstraints({ notBeforeMin: 8.5 })).toBe(false);
  });

  it('rejects a window that is inverted or empty', () => {
    expect(validateConstraints({ notBeforeMin: 800, notAfterMin: 600 })).toBe(false);
    expect(validateConstraints({ notBeforeMin: 600, notAfterMin: 600 })).toBe(false);
  });

  it('rejects a date that is not an Israel calendar day', () => {
    // The insidious one: a wrongly-shaped date never matches any day, so the
    // day the caller ruled out would simply be scheduled as if they had not.
    expect(validateConstraints({ excludeDates: ['28/07/2026'] })).toBe(false);
    expect(validateConstraints({ excludeDates: ['2026-7-28'] })).toBe(false);
    expect(validateConstraints({ excludeDates: ['2026-02-31'] })).toBe(false);
    expect(validateConstraints({ excludeDates: ['2026-13-01'] })).toBe(false);
    expect(validateConstraints({ excludeDates: [''] })).toBe(false);
  });

  it('is what the search consults before doing anything else', () => {
    const got = findCallbackSlot({
      busy: [],
      bookedPerDay: {},
      preferredMs: at(TUE, '09:00'),
      nowMs: at(TUE, '07:00'),
      constraints: { notBeforeMin: 800, notAfterMin: 600 },
    });
    expect(got).toEqual({ ok: false, reason: 'invalid_constraints' });
  });
});

// The ranking layer. Added 28.07.2026 after a live request exposed that the
// engine had only two of the three layers the scheduling literature describes:
// hard constraints PRUNE, soft preferences RANK. With no rank, the form's
// time-of-day band was smuggled in as the search's starting instant, where it
// collided with the window the caller had written in free text.
describe('rank — where inside the allowed set to aim', () => {
  const base = { busy: [] as BusyWindow[], bookedPerDay: {} as Record<string, number> };

  it('defaults to earliest, and is byte-identical to no rank at all', () => {
    const withNone = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '06:00'),
      nowMs: at('2026-07-27', '20:00'),
    });
    const withEarliest = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '06:00'),
      nowMs: at('2026-07-27', '20:00'),
      rank: 'earliest',
    });
    expect(withNone).toEqual(withEarliest);
  });

  it('THE LIVE CASE: a caller who wrote 08:00-13:00 and ticked "afternoon"', () => {
    // Before the rank existed this produced the NEXT day at 09:00 — the band's
    // 16:00 was the search start, it did not fit before 13:00, and the day was
    // lost. All three signals are now honoured at once.
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '00:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { notBeforeMin: 8 * 60, notAfterMin: 13 * 60 },
      rank: 'late',
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe(TUE);
      // The last start that still ends by 13:00.
      expect(hhmm(got.startMs)).toBe('12:45');
      expect(hhmm(got.endMs)).toBe('13:00');
    }
  });

  it('aims at the late end of the business day when the caller set no window', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at('2026-07-27', '20:00'),
      rank: 'late',
    });
    expect(got.ok).toBe(true);
    // Tuesday closes at 18:00; a start must be strictly inside business hours.
    if (got.ok) expect(hhmm(got.startMs)).toBe('17:55');
  });

  it('ranks WITHIN the day the hard constraints allow — never a different day', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '09:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { excludeDates: [TUE] },
      rank: 'late',
    });
    expect(got.ok).toBe(true);
    // Tuesday is pruned; ranking then applies to Wednesday, not to Tuesday.
    if (got.ok) expect(day(got.startMs)).toBe('2026-07-29');
  });

  it('steps over a real appointment sitting at the late end', () => {
    const got = findCallbackSlot({
      ...base,
      busy: [busy(TUE, '17:00', '18:00')],
      preferredMs: at(TUE, '09:00'),
      nowMs: at('2026-07-27', '20:00'),
      rank: 'late',
    });
    expect(got.ok).toBe(true);
    // 17:55 and 17:00-17:45 overlap the meeting; 16:45 ends exactly at 17:00.
    if (got.ok) {
      expect(hhmm(got.startMs)).toBe('16:45');
      expect(got.startMs).toBeLessThan(at(TUE, '17:00'));
    }
  });

  it('never returns a slot earlier than the minimum notice allows', () => {
    const now = at(TUE, '16:00');
    const got = findCallbackSlot({ ...base, preferredMs: now, nowMs: now, rank: 'late' });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.startMs).toBeGreaterThanOrEqual(now + DEFAULT_CALLBACK_POLICY.minNoticeMs);
    }
  });

  it('still refuses Friday afternoon — ranking cannot reach past closing', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(FRI, '09:00'),
      nowMs: at('2026-07-30', '08:00'),
      rank: 'late',
    });
    expect(got.ok).toBe(true);
    // Friday closes at 13:00, so the latest start is 12:55 — not 17:55.
    if (got.ok) {
      expect(day(got.startMs)).toBe(FRI);
      expect(hhmm(got.startMs)).toBe('12:55');
    }
  });
});

// 'nearest' — for a caller who named a moment. The moment is often taken; the
// honest answer is then the closest workable one in EITHER direction, which is
// what the form's "נשתדל לחזור בטווח שבחרת" already promises.
describe('rank: nearest to the moment the caller asked for', () => {
  const base = { busy: [] as BusyWindow[], bookedPerDay: {} as Record<string, number> };

  it('gives the exact moment when it is free', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '16:00'),
      nowMs: at('2026-07-27', '20:00'),
      rank: 'nearest',
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('16:00');
  });

  it('goes BACKWARDS when earlier is closer than later', () => {
    // 16:00-17:00 is booked. Forward-only would answer 17:00; 15:45 is nearer.
    const got = findCallbackSlot({
      ...base,
      busy: [busy(TUE, '16:00', '17:00')],
      preferredMs: at(TUE, '16:00'),
      nowMs: at('2026-07-27', '20:00'),
      rank: 'nearest',
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(hhmm(got.startMs)).toBe('15:45');
      expect(got.startMs).toBeLessThan(at(TUE, '16:00'));
    }
  });

  it('goes forwards when that is the closer side', () => {
    // The target sits inside a 15:00-16:30 meeting. Before it, the nearest free
    // start is 14:45 (75 minutes away); after it, 16:30 (30). Forward wins here
    // on distance alone, not because the search only looks that way.
    const got = findCallbackSlot({
      ...base,
      busy: [busy(TUE, '15:00', '16:30')],
      preferredMs: at(TUE, '16:00'),
      nowMs: at('2026-07-27', '20:00'),
      rank: 'nearest',
    });
    expect(got.ok).toBe(true);
    if (got.ok) expect(hhmm(got.startMs)).toBe('16:30');
  });

  it('stays inside the caller\'s own window while getting close', () => {
    // Asked for 16:00 but is only reachable until 13:00 — the window wins, and
    // "nearest" means the closest instant INSIDE it.
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '16:00'),
      nowMs: at('2026-07-27', '20:00'),
      constraints: { notBeforeMin: 8 * 60, notAfterMin: 13 * 60 },
      rank: 'nearest',
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(day(got.startMs)).toBe(TUE);
      expect(hhmm(got.startMs)).toBe('12:45');
    }
  });

  it('never books before the minimum notice to get closer', () => {
    const now = at(TUE, '14:00');
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(TUE, '14:30'),
      nowMs: now,
      rank: 'nearest',
    });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.startMs).toBeGreaterThanOrEqual(now + DEFAULT_CALLBACK_POLICY.minNoticeMs);
      expect(hhmm(got.startMs)).toBe('16:00');
    }
  });

  it('falls back to the day-level answer when the named day is impossible', () => {
    const got = findCallbackSlot({
      ...base,
      preferredMs: at(SAT, '12:00'),
      nowMs: at(FRI, '08:00'),
      rank: 'nearest',
    });
    expect(got.ok).toBe(true);
    // Saturday cannot host it; the nearest workable day answers instead.
    if (got.ok) expect(day(got.startMs)).toBe(SUN);
  });
});

describe('clampIntoCallbackWindow', () => {
  it('returns the same instant when it already falls inside the window', () => {
    const target = at(TUE, '11:00');
    expect(clampIntoCallbackWindow(target)).toBe(target);
  });

  it('clamps forward to the same day\'s window start when too early', () => {
    const target = at(TUE, '03:00');
    expect(day(clampIntoCallbackWindow(target))).toBe(TUE);
    expect(hhmm(clampIntoCallbackWindow(target))).toBe('09:00');
  });

  it('clamps to the NEXT day\'s window start when past today\'s window end', () => {
    const target = at(TUE, '20:00');
    const got = clampIntoCallbackWindow(target);
    expect(day(got)).toBe('2026-07-29'); // Wednesday
    expect(hhmm(got)).toBe('09:00');
  });

  it('skips a closed day (Saturday) entirely', () => {
    const target = at(FRI, '14:00'); // past Friday's 13:00 close
    const got = clampIntoCallbackWindow(target);
    expect(day(got)).toBe(SUN);
    expect(hhmm(got)).toBe('09:00');
  });

  it('honours Friday\'s shorter window end (13:00, not 18:00)', () => {
    const target = at(FRI, '12:00');
    expect(clampIntoCallbackWindow(target)).toBe(target);
    const late = at(FRI, '13:30');
    const got = clampIntoCallbackWindow(late);
    expect(day(got)).toBe(SUN);
  });
});
