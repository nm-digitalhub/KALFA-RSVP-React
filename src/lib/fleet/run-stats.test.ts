import { describe, expect, it } from 'vitest';

import { aggregateRunIndex, findRunaways, localDate, rangeStartDate } from './run-stats';

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe('localDate', () => {
  it('buckets a UTC timestamp by its Asia/Jerusalem date', () => {
    expect(localDate('2026-09-27T22:30:00.000Z')).toBe('2026-09-28');
    expect(localDate('2026-09-27T23:59:00+03:00')).toBe('2026-09-27');
  });

  it('returns null for an unparsable timestamp', () => {
    expect(localDate('not-a-date')).toBeNull();
  });
});

describe('rangeStartDate', () => {
  it('includes today as the first of N days', () => {
    expect(rangeStartDate('1d', new Date('2026-09-27T12:00:00+03:00'))).toBe('2026-09-27');
    expect(rangeStartDate('7d', new Date('2026-09-27T12:00:00+03:00'))).toBe('2026-09-21');
  });

  it('rejects an unknown range', () => {
    expect(rangeStartDate('90d', new Date())).toBeNull();
  });

  // The range is N local CALENDAR days ending today, not N×24h back from the instant. Around a DST switch the
  // two differ for the hour after midnight (Israel 2026: summer time starts Fri 27.3 02:00, ends Sun 25.10 02:00).
  it('spring switch: 00:30 on 28.3 (the day after the 23-hour day) — 7d starts 22.3', () => {
    const now = new Date('2026-03-28T00:30:00+03:00');
    expect(rangeStartDate('1d', now)).toBe('2026-03-28');
    expect(rangeStartDate('7d', now)).toBe('2026-03-22'); // instant − 144h read as 21.3
    expect(rangeStartDate('30d', now)).toBe('2026-02-27');
  });

  it('autumn switch: 23:30 on the 25-hour day 25.10 — 7d starts 19.10, 1d starts 25.10', () => {
    const now = new Date('2026-10-25T23:30:00+02:00');
    expect(rangeStartDate('1d', now)).toBe('2026-10-25');
    expect(rangeStartDate('7d', now)).toBe('2026-10-19'); // instant − 144h read as 20.10
    expect(rangeStartDate('30d', now)).toBe('2026-09-26');
  });

  it('is decided by the Israel date, not the UTC one', () => {
    // 22:30Z on the 27th is already the 28th in Israel (01:30 IDT).
    expect(rangeStartDate('1d', new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28');
    expect(rangeStartDate('7d', new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-22');
  });
});

describe('aggregateRunIndex / findRunaways', () => {
  const lines = [
    line({ ts: '2026-09-27T11:30:44+03:00', role: 'social-manager', started: '20260927T113043', reason: 'slot' }),
    line({ ts: '2026-09-27T12:11:45+03:00', role: 'social-manager', started: '20260927T121144', reason: 'verdict:62dc162c-7425-4801-9bf1-bf01901acec9' }),
    line({ ts: '2026-09-27T12:12:00+03:00', role: 'social-manager', skipped: 'lock' }),
    line({ ts: '2026-09-27T12:13:00.000Z', role: 'social-manager', stranded_verdict: '62dc162c-7425-4801-9bf1-bf01901acec9' }),
    line({ ts: '2026-09-27T13:00:10+03:00', role: 'fleet-maintainer', started: '20260927T130010' }),
    line({ ts: '2026-09-20T13:00:10+03:00', role: 'fleet-maintainer', started: '20260920T130010' }),
    '{"cost_usd":}',
    '',
  ];

  it('counts starts, lock-skips, verdict starts and strandings per role per day, skipping corrupt lines', () => {
    expect(aggregateRunIndex(lines, '2026-09-21')).toEqual([
      { role: 'fleet-maintainer', date: '2026-09-27', started: 1, lockSkipped: 0, verdictStarts: 0, stranded: 0 },
      { role: 'social-manager', date: '2026-09-27', started: 2, lockSkipped: 1, verdictStarts: 1, stranded: 1 },
    ]);
  });

  it('flags role-days over the threshold or with a stranded verdict', () => {
    const stats = aggregateRunIndex(lines, '2026-09-01');
    expect(findRunaways(stats, 10).map((s) => s.role)).toEqual(['social-manager']);
    expect(findRunaways(stats, 1).map((s) => `${s.date}|${s.role}`)).toEqual(['2026-09-27|social-manager']);
  });

  it('counts a spawn-heavy day (41 starts + 9 lock-skips, as on 2026-09-27) as a runaway', () => {
    const heavy = [
      ...Array.from({ length: 41 }, () => line({ ts: '2026-09-27T12:00:00+03:00', role: 'social-manager', started: 'x' })),
      ...Array.from({ length: 9 }, () => line({ ts: '2026-09-27T12:00:00+03:00', role: 'social-manager', skipped: 'lock' })),
    ];
    expect(findRunaways(aggregateRunIndex(heavy, '2026-09-27'), 10)).toHaveLength(1);
  });
});
