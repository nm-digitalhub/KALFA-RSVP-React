import { describe, expect, it, vi } from 'vitest';

import { QUEUES, type OutreachCallRequest } from '@/lib/queue/queues';

import {
  CALL_WAIT_MAX,
  DEFERRABLE_REASONS,
  RETRY_AFTER_MS,
  callWaitJobId,
  callWaitSpreadMs,
  decideCallWait,
  deferCall,
  retryNotBeforeMs,
  type DeferralReason,
} from './call-dispatch-wait';

const job = { campaignId: 'camp-1', contactId: 'con-1', touchpointIndex: 3 };
const HOUR = 3_600_000;
const EXPIRY = Date.parse('2026-11-12T21:00:00Z');
const SPREAD_CEILING = 10 * 60_000; // the widest spread, the dial window's

describe('decideCallWait', () => {
  it.each(DEFERRABLE_REASONS)('defers a %s refusal to its moment, counted from 1, never earlier than that moment', (reason) => {
    const notBeforeMs = EXPIRY - 10 * HOUR;
    const d = decideCallWait({ job, reason, notBeforeMs, expiryMs: EXPIRY });
    expect(d.action).toBe('defer');
    if (d.action !== 'defer') return;
    expect(d.wait).toBe(1);
    expect(d.runAtMs).toBeGreaterThanOrEqual(notBeforeMs);
    expect(d.runAtMs).toBeLessThan(notBeforeMs + SPREAD_CEILING);
  });

  it('counts on from the waits already used', () => {
    const d = decideCallWait({
      job: { ...job, dispatchWaits: 4 },
      reason: 'max_concurrency',
      notBeforeMs: EXPIRY - 10 * HOUR,
      expiryMs: EXPIRY,
    });
    expect(d).toMatchObject({ action: 'defer', wait: 5 });
  });

  it.each(DEFERRABLE_REASONS)('settles a %s refusal when the moment is not before the end of the event day', (reason) => {
    expect(decideCallWait({ job, reason, notBeforeMs: EXPIRY, expiryMs: EXPIRY })).toEqual({
      action: 'settle',
      reason: 'no_window_before_event_end',
    });
    expect(decideCallWait({ job, reason, notBeforeMs: EXPIRY + HOUR, expiryMs: EXPIRY })).toEqual({
      action: 'settle',
      reason: 'no_window_before_event_end',
    });
  });

  it('settles when no moment exists at all (the dial window does not open in the look-ahead)', () => {
    expect(decideCallWait({ job, reason: 'outside_dial_window', notBeforeMs: null, expiryMs: EXPIRY })).toEqual({
      action: 'settle',
      reason: 'no_window_before_event_end',
    });
  });

  it('settles when the event end is unknown (expiry 0), never deferring without a bound', () => {
    expect(decideCallWait({ job, reason: 'max_concurrency', notBeforeMs: Date.now() + 1000, expiryMs: 0 })).toMatchObject({
      action: 'settle',
    });
  });

  it('settles after the last permitted wait', () => {
    expect(
      decideCallWait({
        job: { ...job, dispatchWaits: CALL_WAIT_MAX },
        reason: 'campaign_hour_cap',
        notBeforeMs: EXPIRY - 10 * HOUR,
        expiryMs: EXPIRY,
      }),
    ).toEqual({ action: 'settle', reason: 'wait_limit' });
  });

  it('never schedules at or after the end of the event day, even when the spread would push it there', () => {
    const d = decideCallWait({ job, reason: 'outside_dial_window', notBeforeMs: EXPIRY - 1_000, expiryMs: EXPIRY });
    expect(d.action).toBe('defer');
    if (d.action !== 'defer') return;
    expect(d.runAtMs).toBeLessThan(EXPIRY);
  });
});

describe('what a wait is for each reason', () => {
  it('the calendar-free reasons come back after their own, increasing, waits', () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    expect(retryNotBeforeMs('max_concurrency', now)).toBe(now + RETRY_AFTER_MS.max_concurrency);
    expect(retryNotBeforeMs('campaign_hour_cap', now)).toBe(now + RETRY_AFTER_MS.campaign_hour_cap);
    expect(retryNotBeforeMs('balance_below_reserve', now)).toBe(now + RETRY_AFTER_MS.balance_below_reserve);
    expect(RETRY_AFTER_MS.max_concurrency).toBeLessThan(RETRY_AFTER_MS.campaign_hour_cap);
    expect(RETRY_AFTER_MS.campaign_hour_cap).toBeLessThan(RETRY_AFTER_MS.balance_below_reserve);
  });

  it('a busy-slot wait is short and its spread is narrower than the dial window one', () => {
    for (let i = 0; i < 100; i += 1) {
      const c = { ...job, contactId: `con-${i}` };
      expect(callWaitSpreadMs(c, 1, 'max_concurrency')).toBeLessThan(2 * 60_000);
      expect(callWaitSpreadMs(c, 1, 'outside_dial_window')).toBeLessThan(10 * 60_000);
    }
  });
});

describe('deterministic ids and spread', () => {
  it('the same wait of the same call always has the same id; another wait or another call does not', () => {
    expect(callWaitJobId(job, 2)).toBe(callWaitJobId({ ...job }, 2));
    expect(callWaitJobId(job, 2)).not.toBe(callWaitJobId(job, 3));
    expect(callWaitJobId(job, 2)).not.toBe(callWaitJobId({ ...job, touchpointIndex: 4 }, 2));
    expect(callWaitJobId(job, 2)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('the id does not depend on the reason, so a call that is refused for two reasons in turn never repeats an id', () => {
    const reasons: DeferralReason[] = ['max_concurrency', 'campaign_hour_cap'];
    const ids = new Set<string>();
    reasons.forEach((_, i) => ids.add(callWaitJobId(job, i + 1)));
    expect(ids.size).toBe(2);
  });

  it('the spread is stable per call, wait and reason', () => {
    expect(callWaitSpreadMs(job, 1, 'max_concurrency')).toBe(callWaitSpreadMs(job, 1, 'max_concurrency'));
  });
});

describe('deferCall', () => {
  it('re-sends the same payload on the call queue with the wait counted, a per-wait id and a start time', async () => {
    const send = vi.fn().mockResolvedValue('id');
    const data: OutreachCallRequest = {
      ...job,
      eventId: 'ev-1',
      normalizedPhone: '+972500000000',
      scriptKey: 'call_1',
    };
    const runAtMs = EXPIRY - 5 * HOUR;
    await deferCall({ send }, data, { action: 'defer', wait: 2, runAtMs });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      QUEUES.callRequest,
      { ...data, dispatchWaits: 2 },
      expect.objectContaining({ id: callWaitJobId(data, 2), startAfter: new Date(runAtMs), retryLimit: 2 }),
    );
  });
});
