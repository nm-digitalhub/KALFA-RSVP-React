import { describe, expect, it } from 'vitest';

import {
  touchpointTime,
  nextTouchpointIndex,
  firstDueIndex,
  detId,
  type Touchpoint,
} from '@/lib/outreach/schedule';

// The live schedule shape (event-date-anchored).
const SCHEDULE: Touchpoint[] = [
  { days_before: 10, channel: 'whatsapp', message_key: 'invite' },
  { days_before: 6, channel: 'whatsapp', message_key: 'reminder_1' },
  { days_before: 3, channel: 'whatsapp', message_key: 'reminder_2' },
  { days_before: 2, channel: 'call', message_key: 'call_1' },
  { days_before: 1, channel: 'whatsapp', message_key: 'final' },
];

const EVENT = '2026-07-20T18:00:00.000Z';
const ev = (d: number) => new Date(EVENT).getTime() - d * 86_400_000;

describe('touchpointTime', () => {
  it('is event_date minus days_before days', () => {
    expect(touchpointTime(EVENT, 10).getTime()).toBe(ev(10));
    expect(touchpointTime(EVENT, 0).getTime()).toBe(new Date(EVENT).getTime());
  });
});

describe('nextTouchpointIndex', () => {
  it('returns the next future touchpoint after the current index', () => {
    // now = 11 days before the event → index 0 (10d) is the next future one.
    expect(nextTouchpointIndex(SCHEDULE, EVENT, -1, ev(11))).toBe(0);
    // after index 0, now just before the 6d mark → index 1.
    expect(nextTouchpointIndex(SCHEDULE, EVENT, 0, ev(7))).toBe(1);
  });
  it('returns null when no future touchpoint remains', () => {
    expect(nextTouchpointIndex(SCHEDULE, EVENT, 4, ev(0.5))).toBeNull();
    expect(nextTouchpointIndex(SCHEDULE, EVENT, -1, ev(-1))).toBeNull(); // event passed
  });
});

describe('firstDueIndex', () => {
  it('seeds at the earliest future touchpoint', () => {
    expect(firstDueIndex(SCHEDULE, EVENT, ev(11))).toBe(0); // all future → first
    expect(firstDueIndex(SCHEDULE, EVENT, ev(4))).toBe(2); // 10/6 past, 3d next
  });
  it('fires the latest past touchpoint when all are past (fire_first_now)', () => {
    expect(firstDueIndex(SCHEDULE, EVENT, ev(0.5))).toBe(4); // all past → last (1d)
  });
  it('returns null for an empty schedule', () => {
    expect(firstDueIndex([], EVENT, ev(5))).toBeNull();
  });
});

describe('detId', () => {
  it('is a stable, valid UUID for the same inputs', () => {
    const a = detId('camp1', 'c1', 0);
    const b = detId('camp1', 'c1', 0);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it('differs by campaign, contact, and step', () => {
    const base = detId('camp1', 'c1', 0);
    expect(detId('camp2', 'c1', 0)).not.toBe(base);
    expect(detId('camp1', 'c2', 0)).not.toBe(base);
    expect(detId('camp1', 'c1', 1)).not.toBe(base);
  });
});
