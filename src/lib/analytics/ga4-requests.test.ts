import { describe, expect, it } from 'vitest';

import { buildCoreBatchA, buildCoreBatchB, buildRealtimeRequests } from './ga4-requests';
import { parseRange, rangeDayCount, rangeToDateRange, type AnalyticsRange } from './ga4-types';

const ALL_RANGES: AnalyticsRange[] = ['today', '7d', '30d', '90d'];

describe('parseRange', () => {
  it('accepts exactly the four legal values', () => {
    for (const r of ALL_RANGES) expect(parseRange(r)).toBe(r);
  });

  it('falls back to 30d on any invalid input', () => {
    expect(parseRange(undefined)).toBe('30d');
    expect(parseRange('')).toBe('30d');
    expect(parseRange('60d')).toBe('30d');
    expect(parseRange('זבל')).toBe('30d');
    expect(parseRange(['7d', '30d'])).toBe('30d'); // array = invalid
  });
});

describe('rangeToDateRange / rangeDayCount', () => {
  it('maps each range to the exact GA date expressions', () => {
    expect(rangeToDateRange('today')).toEqual({ startDate: 'today', endDate: 'today' });
    expect(rangeToDateRange('7d')).toEqual({ startDate: '7daysAgo', endDate: 'today' });
    expect(rangeToDateRange('30d')).toEqual({ startDate: '30daysAgo', endDate: 'today' });
    expect(rangeToDateRange('90d')).toEqual({ startDate: '90daysAgo', endDate: 'today' });
  });

  it('day counts are inclusive of both ends (NdaysAgo..today = N+1)', () => {
    expect(rangeDayCount('today')).toBe(1);
    expect(rangeDayCount('7d')).toBe(8);
    expect(rangeDayCount('30d')).toBe(31);
    expect(rangeDayCount('90d')).toBe(91);
  });
});

describe('buildCoreBatchA', () => {
  it('contains exactly 5 reports with quota on the first only', () => {
    const reqs = buildCoreBatchA('30d');
    expect(reqs).toHaveLength(5);
    expect(reqs[0].returnPropertyQuota).toBe(true);
    expect(reqs.slice(1).every((r) => !r.returnPropertyQuota)).toBe(true);
  });

  it('derives dateRanges from the given range, for every range', () => {
    for (const range of ALL_RANGES) {
      for (const req of buildCoreBatchA(range)) {
        expect(req.dateRanges).toEqual([rangeToDateRange(range)]);
      }
    }
  });

  it('overview report carries the six v2 metrics in contract order', () => {
    const names = buildCoreBatchA('7d')[0].metrics?.map((m) => m.name);
    expect(names).toEqual([
      'activeUsers',
      'newUsers',
      'sessions',
      'screenPageViews',
      'engagementRate',
      'averageSessionDuration',
    ]);
  });

  it('top pages excludes every token surface and is limited', () => {
    const top = buildCoreBatchA('30d')[2];
    expect(top.limit).toBe(10);
    const prefixes = top.dimensionFilter?.notExpression?.orGroup?.expressions?.map(
      (e) => e.filter?.stringFilter?.value,
    );
    expect(prefixes).toEqual(['/r/', '/g/', '/ty/', '/join/']);
    expect(
      top.dimensionFilter?.notExpression?.orGroup?.expressions?.every(
        (e) => e.filter?.stringFilter?.matchType === 'BEGINS_WITH',
      ),
    ).toBe(true);
  });

  it('sources uses the session-scoped dimensions', () => {
    const sources = buildCoreBatchA('30d')[4];
    expect(sources.dimensions?.map((d) => d.name)).toEqual(['sessionSource', 'sessionMedium']);
  });
});

describe('buildCoreBatchB', () => {
  it('contains exactly 3 reports with quota on the first only', () => {
    const reqs = buildCoreBatchB('30d');
    expect(reqs).toHaveLength(3);
    expect(reqs[0].returnPropertyQuota).toBe(true);
    expect(reqs.slice(1).every((r) => !r.returnPropertyQuota)).toBe(true);
  });

  it('events report detects key events via the keyEvents METRIC — no name allowlist, no flag dimension', () => {
    const events = buildCoreBatchB('30d')[2];
    expect(events.dimensions?.map((d) => d.name)).toEqual(['eventName']);
    expect(events.metrics?.map((m) => m.name)).toEqual(['eventCount', 'keyEvents']);
    expect(JSON.stringify(events)).not.toContain('sign_up');
  });
});

describe('buildRealtimeRequests', () => {
  it('is exactly 3 requests and the activeUsers request has no dimensions', () => {
    const reqs = buildRealtimeRequests();
    expect(reqs).toHaveLength(3);
    expect(reqs[0].dimensions).toBeUndefined();
    expect(reqs[0].metrics?.map((m) => m.name)).toEqual(['activeUsers']);
    expect(reqs[1].dimensions?.map((d) => d.name)).toEqual(['eventName']);
    expect(reqs[2].dimensions?.map((d) => d.name)).toEqual(['city']);
  });
});
