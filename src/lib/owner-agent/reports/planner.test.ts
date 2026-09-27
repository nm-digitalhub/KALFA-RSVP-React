import { describe, expect, it } from 'vitest';

import {
  REPORT_CATCH_UP_MINUTES,
  localParts,
  normalizeSlotTime,
  planDueSlots,
  reportPeriod,
  wallTimeToInstant,
} from './planner';

const IL = 'Asia/Jerusalem';
const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);
const sub = (slotTime: string, id = 's1', timezone = IL) => ({ id, slotTime, timezone });

// Israel 2026 (measured with Intl on this machine): summer time starts on
// 27.3 at 02:00 (→ 03:00, 00:00Z) and ends on 25.10 at 02:00 (→ 01:00, 23:00Z
// on the 24th). 28.9 00:00 in Israel is 27.9 21:00Z (UTC+3).

describe('localParts / normalizeSlotTime', () => {
  it('formats into the zone, midnight as 00', () => {
    expect(localParts(at('2026-09-27T21:00:00Z'), IL)).toEqual({ date: '2026-09-28', time: '00:00' });
    expect(localParts(at('2026-09-28T05:00:00Z'), IL)).toEqual({ date: '2026-09-28', time: '08:00' });
  });

  it('reads the stored HH:MM:SS and refuses anything else', () => {
    expect(normalizeSlotTime('08:00:00')).toBe('08:00');
    expect(normalizeSlotTime('00:00')).toBe('00:00');
    expect(normalizeSlotTime('08:00:30')).toBeNull();
    expect(normalizeSlotTime('24:00')).toBeNull();
    expect(normalizeSlotTime('8:00')).toBeNull();
  });
});

describe('planDueSlots', () => {
  it('a slot is due from its minute for the catch-up window, keyed by the LOCAL date', () => {
    const slot = at('2026-09-27T21:00:00Z'); // 28.9 00:00 IL — the UTC date is still the 27th
    expect(planDueSlots([sub('00:00:00')], slot)).toEqual([
      { subscriptionId: 's1', localDate: '2026-09-28', slotTime: '00:00', lateMinutes: 0 },
    ]);
    expect(planDueSlots([sub('00:00:00')], slot + (REPORT_CATCH_UP_MINUTES - 1) * MIN + 59_000)).toEqual([
      { subscriptionId: 's1', localDate: '2026-09-28', slotTime: '00:00', lateMinutes: REPORT_CATCH_UP_MINUTES - 1 },
    ]);
    expect(planDueSlots([sub('00:00:00')], slot + REPORT_CATCH_UP_MINUTES * MIN)).toEqual([]);
    expect(planDueSlots([sub('00:00:00')], slot - 1)).toEqual([]);
  });

  it('plans each subscription on its own, and skips an unreadable slot or zone', () => {
    const now = at('2026-09-28T05:10:00Z'); // 08:10 IL
    expect(
      planDueSlots([sub('08:00:00', 'a'), sub('00:00:00', 'b'), sub('bad', 'c'), sub('08:00:00', 'd', 'Not/AZone')], now),
    ).toEqual([{ subscriptionId: 'a', localDate: '2026-09-28', slotTime: '08:00', lateMinutes: 10 }]);
  });

  it('the repeated autumn hour gives both readings the SAME key (the unique key keeps one run)', () => {
    const first = planDueSlots([sub('01:30:00')], at('2026-10-24T22:30:00Z')); // 01:30 IDT
    const second = planDueSlots([sub('01:30:00')], at('2026-10-24T23:30:00Z')); // 01:30 IST
    expect(first.map((d) => [d.localDate, d.slotTime])).toEqual([['2026-10-25', '01:30']]);
    expect(second.map((d) => [d.localDate, d.slotTime])).toEqual([['2026-10-25', '01:30']]);
  });

  it('a slot inside the spring-forward gap is never due that day', () => {
    const due: string[] = [];
    for (let t = at('2026-03-26T22:00:00Z'); t <= at('2026-03-27T03:00:00Z'); t += 5 * MIN) {
      for (const d of planDueSlots([sub('02:30:00')], t)) due.push(d.localDate);
    }
    expect(due).toEqual([]);
  });

  it('midnight is due on both switch days', () => {
    expect(planDueSlots([sub('00:00:00')], at('2026-03-26T22:00:00Z'))[0]?.localDate).toBe('2026-03-27');
    expect(planDueSlots([sub('00:00:00')], at('2026-10-25T22:00:00Z'))[0]?.localDate).toBe('2026-10-26');
  });
});

describe('wallTimeToInstant', () => {
  it('is right on both sides of each switch (no noon probe)', () => {
    expect(new Date(wallTimeToInstant('2026-03-27', '00:00', IL)).toISOString()).toBe('2026-03-26T22:00:00.000Z');
    expect(new Date(wallTimeToInstant('2026-03-28', '00:00', IL)).toISOString()).toBe('2026-03-27T21:00:00.000Z');
    expect(new Date(wallTimeToInstant('2026-10-25', '00:00', IL)).toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(new Date(wallTimeToInstant('2026-10-26', '00:00', IL)).toISOString()).toBe('2026-10-25T22:00:00.000Z');
    expect(new Date(wallTimeToInstant('2026-09-28', '08:00:00', IL)).toISOString()).toBe('2026-09-28T05:00:00.000Z');
  });

  it('throws on a malformed key', () => {
    expect(() => wallTimeToInstant('28.9.2026', '08:00', IL)).toThrow('report_bad_slot');
    expect(() => wallTimeToInstant('2026-09-28', '8', IL)).toThrow('report_bad_slot');
  });
});

describe('reportPeriod', () => {
  it('00:00 covers the whole local day that ended, without a snapshot', () => {
    expect(reportPeriod('2026-09-28', '00:00:00', IL)).toEqual({
      sinceIso: '2026-09-26T21:00:00.000Z',
      untilIso: '2026-09-27T21:00:00.000Z',
      includeSnapshot: false,
      label: '27.9',
    });
  });

  it('08:00 covers 00:00–08:00 of the same day, with a snapshot', () => {
    expect(reportPeriod('2026-09-28', '08:00:00', IL)).toEqual({
      sinceIso: '2026-09-27T21:00:00.000Z',
      untilIso: '2026-09-28T05:00:00.000Z',
      includeSnapshot: true,
      label: '28.9 00:00–08:00',
    });
  });

  it('the 25-hour and 23-hour days are whole days', () => {
    const autumn = reportPeriod('2026-10-26', '00:00', IL);
    expect([autumn.sinceIso, autumn.untilIso]).toEqual(['2026-10-24T21:00:00.000Z', '2026-10-25T22:00:00.000Z']);
    expect(Date.parse(autumn.untilIso) - Date.parse(autumn.sinceIso)).toBe(25 * 60 * MIN);
    const spring = reportPeriod('2026-03-28', '00:00', IL);
    expect([spring.sinceIso, spring.untilIso]).toEqual(['2026-03-26T22:00:00.000Z', '2026-03-27T21:00:00.000Z']);
    expect(Date.parse(spring.untilIso) - Date.parse(spring.sinceIso)).toBe(23 * 60 * MIN);
  });
});
