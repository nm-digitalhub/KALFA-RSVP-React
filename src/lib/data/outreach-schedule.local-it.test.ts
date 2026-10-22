import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PgBoss } from 'pg-boss';
import type { Pool } from 'pg';

import { israelCalendarDay, ilWallTimeToIso } from '@/lib/data/event-date';
import { buildJewishCalendar } from '@/lib/outreach/jewish-calendar';
import {
  type Fixture,
  type FixtureOptions,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

// Finding 5 — the outreach ENGINE path (src/lib/data/outreach-engine.ts):
// ensureCurrentStep (plan → evaluateStep → recordPlan / resolveStep → enqueueStepJob)
// and stepGate, against Supabase local.
//   Clock: vi.useFakeTimers({ toFake: ['Date'] }) — only Date is faked, so the engine's
//          Date.now() is controlled while network/timers stay real. The DATABASE clock
//          (now() in triggers / try_record_billed_result) stays REAL; dates are chosen
//          so both clocks agree on what is past/future.
//   Queue: the pg-boss instance is replaced by an object whose send() records jobs —
//          the queue boundary only. Nothing is sent: the engine path under test only
//          plans/enqueues; the send itself (worker handleStep) is not exercised here.
//   Policy / calendar: the real getSendPolicy() (local app_settings) and the real
//          buildJewishCalendar.
// worker/main.ts handleStep (planRev check, stepGate at execution) is NOT importable
// (starts pg-boss on import); its behaviour on a stale job is cited from code only.

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;
const DAY = 86_400_000;

type Job = { queue: string; data: { stepIndex: number; planRev: string; mode: string; targetSlotMs: number }; opts: { id: string; startAfter: Date } };

describe.skipIf(!RUN)('finding 5: outreach engine scheduling — real DB, controlled clock', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let engine: typeof import('@/lib/data/outreach-engine');
  let recordReached: typeof import('@/lib/data/billing').recordReached;
  const jobs: Job[] = [];
  const boss = {
    send: vi.fn(async (queue: string, data: Job['data'], opts: Job['opts']) => {
      jobs.push({ queue, data, opts });
      return opts.id;
    }),
  } as unknown as PgBoss;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'outreach-schedule', 6);
    scope = new FixtureScope(pool);
    engine = await import('@/lib/data/outreach-engine');
    recordReached = (await import('@/lib/data/billing')).recordReached;
  });
  afterEach(() => {
    vi.useRealTimers();
    jobs.length = 0;
  });
  afterAll(async () => {
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
    }
  });

  // The event: at least 30 real days ahead (publish needs ≥ tomorrow), at 19:00 Israel time, on a date whose
  // asserted days are ordinary sending days. The tests assert calendar days: the 7-day touchpoint lands on E−7, a
  // move by 7 days lands it on E, and the controlled "now" is E−10 at 19:00 with E−11 as "yesterday". If one of
  // those days is a Friday, a Shabbat or a Yom Tov, the engine correctly moves the slot (KALFA send window), and an
  // assertion written for an open day fails on that run only. Example: run on 22.10.2026, today+30 is Saturday
  // 21.11.2026, so E−7 (14.11) is Shabbat and the 7-day step was planned for Sunday 15.11. Choosing the event date
  // from the real calendar keeps every assertion about an open day, whatever day the suite runs.
  const OPEN_WEEKDAYS = new Set([0, 1, 2, 3, 4]); // Sunday–Thursday: full KALFA window (Friday closes at noon)
  const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
  const calendar = buildJewishCalendar(Date.now(), Date.now() + 120 * DAY);
  const isOpenDay = (ms: number) => {
    const day = israelCalendarDay(ms);
    return (
      OPEN_WEEKDAYS.has(weekdayOf(day)) &&
      !calendar.isBlocked(Date.parse(ilWallTimeToIso(day, '11:00'))) &&
      !calendar.isBlocked(Date.parse(ilWallTimeToIso(day, '19:00')))
    );
  };
  const eventOnOpenDays = () => {
    for (let days = 30; days < 90; days += 1) {
      const e = ilWallTimeToIso(israelCalendarDay(Date.now() + days * DAY), '19:00');
      const t = Date.parse(e);
      if ([0, 7, 10, 11].every((back) => isOpenDay(t - back * DAY))) return e;
    }
    throw new Error('no event date in 30–90 days with open asserted days');
  };
  const SCHEDULE: NonNullable<FixtureOptions['outreachSchedule']> = [
    { days_before: 7, channel: 'whatsapp', message_key: 'it_7' },
    { days_before: 3, channel: 'whatsapp', message_key: 'it_3' },
    { days_before: 1, channel: 'whatsapp', message_key: 'it_1' },
  ];
  const campaign = async (o: FixtureOptions) => {
    const f = await scope.create({ outreachSchedule: SCHEDULE, allowedChannels: ['whatsapp'], noOutbound: true, ...o });
    expect(await scope.track(engine.seedOutreachState(f.eventId, f.campaignId))).toBe(1);
    return f;
  };
  const at = (ms: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ms);
  };
  const state = async (f: Fixture) =>
    (await pool.query(
      `select status, current_step_index, planned_at, plan_rev from public.outreach_state where campaign_id = $1 and contact_id = $2`,
      [f.campaignId, f.contactId],
    )).rows[0];
  const ilDay = (d: Date | string | number) => israelCalendarDay(new Date(d).getTime());
  const ensure = (f: Fixture, mode: 'plan' | 'replan' | 'defer' = 'plan') =>
    scope.track(engine.ensureCurrentStep(boss, f.campaignId, f.contactId, mode));

  it('plan: 10 days out, the 7-day touchpoint is deferred to its day; queue job and outreach_state carry the same slot', async () => {
    const E = eventOnOpenDays();
    const f = await campaign({ eventDate: E });
    at(Date.parse(E) - 10 * DAY);
    await ensure(f);
    expect(jobs).toHaveLength(1);
    const j = jobs[0];
    expect(j.data).toMatchObject({ stepIndex: 0, mode: 'defer' });
    const s = await state(f);
    expect(new Date(s.planned_at).getTime()).toBe(j.data.targetSlotMs);
    expect(j.opts.startAfter.getTime()).toBe(j.data.targetSlotMs);
    expect(ilDay(s.planned_at)).toBe(israelCalendarDay(Date.parse(E) - 7 * DAY));
  });

  it('date change (later, before any send): replan moves the plan to the new date; the old job is left queued with a stale planRev', async () => {
    const E = eventOnOpenDays();
    const f = await campaign({ eventDate: E });
    at(Date.parse(E) - 10 * DAY);
    await ensure(f);
    const before = await state(f);
    const oldJob = jobs[0];
    const E2 = new Date(Date.parse(E) + 7 * DAY).toISOString();
    await pool.query(`update public.events set event_date = $2 where id = $1`, [f.eventId, E2]); // allowed: nothing sent yet
    await ensure(f, 'replan');
    const after = await state(f);
    expect(after.plan_rev).not.toBe(before.plan_rev);
    expect(ilDay(after.planned_at)).toBe(israelCalendarDay(Date.parse(E2) - 7 * DAY));
    expect(jobs).toHaveLength(2);
    expect(jobs[1].opts.id).not.toBe(oldJob.opts.id);
    expect(jobs[1].data.planRev).toBe(after.plan_rev);
    expect(oldJob.data.planRev).toBe(before.plan_rev); // not cancelled: the worker's handleStep drops it on planRev mismatch (code-read)
    const c = await pool.query(`select close_at from public.campaigns where id = $1`, [f.campaignId]);
    expect(new Date(c.rows[0].close_at).getTime()).toBe(Date.parse(E2)); // trg_sync_campaign_window_from_event
  });

  it('date change (earlier): the engine walks — 7-day skipped (audited), and the overdue 3-day reminder is enqueued to send NOW, a day late (5c through the engine)', async () => {
    const E = eventOnOpenDays();
    const f = await campaign({ eventDate: E });
    at(Date.parse(E) - 10 * DAY);
    await ensure(f);
    jobs.length = 0;
    // The event moves to "now + 2 days 9 h": the 7- and 3-day planned instants are now past.
    const E2 = ilWallTimeToIso(israelCalendarDay(Date.now() + 2 * DAY), '19:00');
    await pool.query(`update public.events set event_date = $2 where id = $1`, [f.eventId, E2]);
    await ensure(f, 'replan');
    const s = await state(f);
    expect(s.current_step_index).toBe(1); // 7-day skipped
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.stepIndex).toBe(1); // the 3-day touchpoint…
    expect(ilDay(jobs[0].data.targetSlotMs)).toBe(israelCalendarDay(Date.parse(E2) - 3 * DAY)); // …planned for yesterday…
    expect(ilDay(jobs[0].opts.startAfter)).toBe(israelCalendarDay(Date.now())); // …runs today (2 days before)
  });

  it('date change AFTER a send: the owner path is locked (R5); the staff RPC admin_reschedule_event (billing_clerk, real local Auth) moves it and the engine replans', async () => {
    const E = eventOnOpenDays();
    const f = await campaign({ eventDate: E, noOutbound: false }); // an outbound message exists
    at(Date.parse(E) - 10 * DAY);
    await ensure(f);
    const before = await state(f);
    const E2 = new Date(Date.parse(E) + 7 * DAY).toISOString();
    await expect(pool.query(`update public.events set event_date = $2 where id = $1`, [f.eventId, E2])).rejects.toThrow(/locked/);
    const clerk = await scope.createAuthUser(ENV!, { staffRole: 'billing_clerk' });
    const r = await clerk.client.rpc('admin_reschedule_event', { _event_id: f.eventId, _event_date: E2 });
    expect(r.error).toBeNull();
    await ensure(f, 'replan');
    const after = await state(f);
    expect(after.plan_rev).not.toBe(before.plan_rev);
    expect(ilDay(after.planned_at)).toBe(israelCalendarDay(Date.parse(E2) - 7 * DAY));
  });

  it('event day passed: the cursor step is terminal — contact exhausted, nothing enqueued', async () => {
    const E = eventOnOpenDays();
    const f = await campaign({ eventDate: E });
    at(Date.parse(E) + DAY);
    await ensure(f);
    expect(jobs).toHaveLength(0);
    expect((await state(f)).status).toBe('exhausted');
  });

  it('close_at: stepGate stops once now > close_at; before it the gate is not "stopped" (local master switch is OFF → "paused")', async () => {
    const E = eventOnOpenDays();
    const closeAt = Date.parse(E) - 2 * DAY;
    const f = await campaign({ eventDate: E, closeAt: new Date(closeAt).toISOString() });
    const before = await engine.stepGate(f.campaignId, f.contactId, f.eventId, closeAt - DAY);
    const after = await engine.stepGate(f.campaignId, f.contactId, f.eventId, closeAt + 60_000);
    expect(before.reason).toBe('paused'); // outreach_enabled = false in local app_settings (not changed by the test)
    expect(after.reason).toBe('stopped');
  });

  it('characterization: ensureCurrentStep itself does not check close_at — it still plans after the window closed (stepGate stops it at execution)', async () => {
    const E = eventOnOpenDays();
    const closeAt = Date.parse(E) - 8 * DAY;
    const f = await campaign({ eventDate: E, closeAt: new Date(closeAt).toISOString() });
    at(Date.parse(E) - 7 * DAY + 3_600_000);
    await ensure(f);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.targetSlotMs).toBeGreaterThan(closeAt);
  });

  it('LATENT 5d: start_at is enforced by billing but not by the outreach engine — a reminder is planned BEFORE the window, and a reply now is refused billing', async () => {
    const E = eventOnOpenDays();
    const startAt = new Date(Date.parse(E) - 5 * DAY).toISOString(); // window opens 5 days before the event
    const f = await campaign({ eventDate: E, startAt });
    at(Date.parse(E) - 10 * DAY);
    await ensure(f);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.targetSlotMs).toBeLessThan(Date.parse(startAt)); // 7-day send planned before start_at
    const gate = await engine.stepGate(f.campaignId, f.contactId, f.eventId, Date.parse(E) - 7 * DAY);
    expect(gate.reason).not.toBe('stopped'); // no start_at branch in stepGate
    vi.useRealTimers();
    const outcome = await scope.track(
      recordReached({
        eventId: f.eventId, campaignId: f.campaignId, contactId: f.contactId, channel: 'whatsapp',
        attemptId: `it-${f.tag}`, evidence: 'whatsapp_inbound_message', providerRef: `it-${f.tag}`,
      }),
    );
    expect(outcome).toBe('before_window'); // try_record_billed_result (real DB clock) refuses
  });
});
