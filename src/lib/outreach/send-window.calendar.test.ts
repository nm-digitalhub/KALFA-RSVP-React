import { describe, expect, it } from 'vitest';

import { israelCalendarDay, ilWallTimeToIso } from '@/lib/data/event-date';
import { buildJewishCalendar } from '@/lib/outreach/jewish-calendar';
import { DEFAULT_SEND_POLICY, hhmmToMin, type SendPolicy } from '@/lib/outreach/send-policy';
import { evaluateStep, resolveSendSlot } from '@/lib/outreach/send-window';
import type { Touchpoint } from '@/lib/outreach/schedule';
import { operationalFieldsSchema } from '@/lib/validation/admin';

// Finding 5 — gaps NOT covered by send-window.test.ts (which drives resolveSendSlot /
// evaluateStep with hand-built calendars). Here: the REAL @hebcal-backed calendar
// (buildJewishCalendar, Jerusalem) and the REAL DEFAULT_SEND_POLICY, on concrete 2026
// dates, with the clock controlled through the explicit nowMs argument (the
// functions are pure; the worker injects Date.now()). Calendar facts are asserted as
// invariants (blocked / not blocked, ≥ havdalah + motzashPlusMin) rather than
// hard-coded candle-lighting minutes.

const P = DEFAULT_SEND_POLICY;
const H = 3_600_000;
const il = (date: string, hhmm: string) => Date.parse(ilWallTimeToIso(date, hhmm));
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const local = (ms: number) => {
  const [h, m] = HM.format(ms).split(':').map(Number);
  return { date: israelCalendarDay(ms), minutes: h * 60 + m };
};
const calAround = (ms: number) => buildJewishCalendar(ms - 10 * 24 * H, ms + 10 * 24 * H);
const slot = (plannedMs: number, nowMs = plannedMs, policy: SendPolicy = P, expiresAtMs = plannedMs + 30 * 24 * H) =>
  resolveSendSlot({ plannedMs, nowMs, expiresAtMs, policy, calendar: calAround(plannedMs), spreadKey: 'it:c:0' });
const sentAt = (r: ReturnType<typeof slot>) => {
  if (r.decision !== 'send') throw new Error(`expected send, got skip:${r.reason}`);
  return r.at;
};
// A legal slot under the real calendar and the policy's weekday window.
const assertLegal = (at: number) => {
  const cal = calAround(at);
  expect(cal.isBlocked(at)).toBe(false);
  const { date, minutes } = local(at);
  const w = P.weekday[new Date(`${date}T00:00:00Z`).getUTCDay()];
  expect(w).not.toBeNull();
  expect(minutes).toBeGreaterThanOrEqual(hhmmToMin(w!.start));
  expect(minutes).toBeLessThan(Math.min(hhmmToMin(w!.end), hhmmToMin(P.hardCap)));
};

describe('finding 5 — window edges and the real calendar', () => {
  it('window START is inclusive: planned exactly 09:00 on a Sunday sends that morning; 08:59 waits for 09:00', () => {
    const at = sentAt(slot(il('2026-11-01', '09:00')));
    expect(local(at).date).toBe('2026-11-01');
    expect(at).toBeGreaterThanOrEqual(il('2026-11-01', '09:00'));
    const early = sentAt(slot(il('2026-11-01', '08:59')));
    expect(early).toBeGreaterThanOrEqual(il('2026-11-01', '09:00'));
    expect(local(early).date).toBe('2026-11-01');
  });

  it('a real Friday (23.10.2026): 11:30 sends before the 12:00 close; 12:00 itself rolls past Shabbat to Sunday ≥ 09:00 (25.10 is also the DST fall-back day)', () => {
    const fri = sentAt(slot(il('2026-10-23', '11:30')));
    expect(fri).toBeGreaterThanOrEqual(il('2026-10-23', '11:30'));
    expect(fri).toBeLessThan(il('2026-10-23', '12:00'));
    const rolled = sentAt(slot(il('2026-10-23', '12:00')));
    expect(local(rolled).date).toBe('2026-10-25');
    expect(local(rolled).minutes).toBeGreaterThanOrEqual(9 * 60);
    assertLegal(rolled);
  });

  it('Yom Kippur 2026 (real calendar): a reminder planned inside the fast lands only after havdalah + motzashPlusMin', () => {
    const planned = il('2026-09-21', '11:00');
    const cal = calAround(planned);
    expect(cal.isBlocked(planned)).toBe(true); // sanity: the real calendar blocks Yom Kippur
    const at = sentAt(slot(planned));
    expect(at).toBeGreaterThanOrEqual(cal.nextClear(planned) + P.motzashPlusMin * 60_000);
    assertLegal(at);
  });

  it('erev Yom Kippur: a 17:30 reminder (3-day preferred time) never spreads into the candle-lighting block', () => {
    const planned = il('2026-09-20', '17:30');
    const cal = calAround(planned);
    expect(cal.isBlocked(planned)).toBe(false);
    const at = sentAt(slot(planned));
    if (local(at).date === '2026-09-20') expect(at).toBeLessThan(cal.nextBlockedStart(planned));
    assertLegal(at);
  });

  it('Rosh Hashana 2026 joined to Shabbat (12–13.9): a Saturday reminder waits for the end of the WHOLE block', () => {
    const planned = il('2026-09-12', '11:00');
    const cal = calAround(planned);
    expect(cal.isBlocked(il('2026-09-13', '12:00'))).toBe(true); // second day of the chag is blocked too
    const at = sentAt(slot(planned));
    expect(at).toBeGreaterThan(il('2026-09-13', '12:00'));
    expect(at).toBeGreaterThanOrEqual(cal.nextClear(planned) + P.motzashPlusMin * 60_000);
    assertLegal(at);
  });

  it('DST spring-forward Friday (27.3.2026): an 11:00 reminder stays inside the 09:00–12:00 LOCAL window (IDT, UTC+3)', () => {
    const at = sentAt(slot(il('2026-03-27', '11:00')));
    expect(local(at).date).toBe('2026-03-27');
    expect(local(at).minutes).toBeGreaterThanOrEqual(11 * 60);
    expect(local(at).minutes).toBeLessThan(12 * 60);
    expect(new Date(at).getUTCHours()).toBe(8);
  });

  it('hardCap wins over a window that ends past it (policy object not passed through parseSendPolicy)', () => {
    const wide: SendPolicy = { ...P, weekday: P.weekday.map((w) => (w ? { ...w, end: '22:30' } : w)) };
    const at = sentAt(slot(il('2026-11-01', '20:55'), undefined, wide));
    expect(local(at).date).toBe('2026-11-01');
    expect(local(at).minutes).toBeLessThan(hhmmToMin(P.hardCap));
    const late = sentAt(slot(il('2026-11-01', '21:00'), undefined, wide));
    expect(local(late).date).toBe('2026-11-02');
  });
});

describe('finding 5 — schedule shape (touchpoint collisions, order, event-day reminders)', () => {
  const tp = (days_before: number, key = `k${days_before}`): Touchpoint => ({ days_before, channel: 'whatsapp', message_key: key });
  const EVENT = ilWallTimeToIso('2026-11-12', '19:00'); // Thursday evening
  const walk = (schedule: Touchpoint[], nowMs: number) => {
    const out: string[] = [];
    const calendar = buildJewishCalendar(nowMs - 30 * 24 * H, Date.parse(EVENT) + 24 * H);
    for (let cursor = 0; cursor < schedule.length; cursor++) {
      const d = evaluateStep({ schedule, cursorIndex: cursor, eventDateIso: EVENT, nowMs, policy: P, calendar, campaignId: 'it', contactId: 'c' });
      out.push(`${schedule[cursor].days_before}d:${d.decision}${'reason' in d ? `:${d.reason}` : ''}`);
      if (d.decision !== 'skip') break; // the engine walks on only after a skip
    }
    return out;
  };

  it('two touchpoints on the SAME day collapse to one: the earlier entry is superseded, the later one is kept (send or its spread defer)', () => {
    const steps = walk([tp(3, 'a'), tp(3, 'b')], il('2026-11-09', '18:00'));
    expect(steps[0]).toBe('3d:skip:superseded_by_later_touchpoint');
    expect(steps[1]).toMatch(/^3d:(send|defer)$/);
  });

  it('the package validator accepts a schedule in NON-descending order (nothing sorts it later)', () => {
    const parsed = operationalFieldsSchema.safeParse({
      contact_quota: 100,
      channels: ['whatsapp'],
      outreach_schedule: [
        { days_before: 1, channel: 'whatsapp', message_key: 'day_before' },
        { days_before: 7, channel: 'whatsapp', message_key: 'week_before' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it.fails('KNOWN BUG 5b: an out-of-order schedule [1, 7] still sends the 1-day reminder', () => {
    // A week before the event: the 7-day touchpoint (index 1) is due, the 1-day one (index 0) is not.
    const steps = walk([tp(1), tp(7)], il('2026-11-05', '12:00'));
    expect(steps[0]).not.toMatch(/^1d:skip/);
  });

  it('characterization 5b: with [1, 7] the 1-day reminder is skipped as "superseded" a week early and never sent', () => {
    expect(walk([tp(1), tp(7)], il('2026-11-05', '12:00'))).toEqual(['1d:skip:superseded_by_later_touchpoint', '7d:send']);
    // and after the 7-day send the cursor is past the end: nothing is left for the day before
  });

  // evaluateStep's MISSED rule says (send-window.ts:234-238): an overdue touchpoint is
  // skipped "rather than silently firing a '3-day' reminder on the 2-day-before day".
  // It compares the SLOT's day with the PLANNED day — and the slot is resolved with
  // nowMs = plannedMs, so it is on the planned day by construction. When the worker
  // only reaches the step on a later day (outage, late activation), nothing compares
  // NOW's day: the 3-day reminder fires on the 2-day-before day.
  const threeDayLate = () =>
    evaluateStep({
      schedule: [tp(7), tp(3), tp(1)], cursorIndex: 1, eventDateIso: EVENT, nowMs: il('2026-11-10', '10:00'), policy: P,
      calendar: buildJewishCalendar(il('2026-11-01', '00:00'), il('2026-11-14', '00:00')), campaignId: 'it', contactId: 'c',
    });

  it.fails('KNOWN BUG 5c: a 3-day reminder reached only on the 2-day-before day is skipped as missed, not sent', () => {
    expect(threeDayLate()).toEqual({ decision: 'skip', reason: 'missed_touchpoint' });
  });

  it('characterization 5c: the overdue 3-day reminder is SENT a day late (planned 9.11 17:30, sent 10.11 at "now")', () => {
    const d = threeDayLate();
    expect(d.decision).toBe('send');
    expect(local((d as { at: number }).at).date).toBe('2026-11-10');
    expect(local((d as { targetSlotMs: number }).targetSlotMs).date).toBe('2026-11-09');
  });

  it('characterization (open decision): an event-day reminder for a MORNING event is scheduled after the event has started', () => {
    const morning = ilWallTimeToIso('2026-11-12', '10:00');
    const now = il('2026-11-12', '08:00');
    const d = evaluateStep({
      schedule: [tp(0)], cursorIndex: 0, eventDateIso: morning, nowMs: now, policy: P,
      calendar: buildJewishCalendar(now - 24 * H, now + 48 * H), campaignId: 'it', contactId: 'c',
    });
    expect(d.decision).toBe('defer');
    // preferred time for an unlisted days_before is defaultPreferred (11:00) — after a 10:00 start
    expect((d as { targetSlotMs: number }).targetSlotMs).toBeGreaterThan(Date.parse(morning));
  });
});
