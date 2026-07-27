import { describe, expect, it } from 'vitest';

import {
  classifyGa4Error,
  fillTrendGaps,
  formatSeconds,
  mapCountries,
  mapEvents,
  mapOverview,
  mapQuota,
  mapRealtime,
  mapTrend,
} from './ga4-mappers';
import type { RunReportResponse } from './ga4-types';

const overviewResp = {
  rows: [
    {
      metricValues: [
        { value: '42' }, // activeUsers
        { value: '17' }, // newUsers
        { value: '55' }, // sessions
        { value: '198' }, // screenPageViews
        { value: '0.5432' }, // engagementRate
        { value: '154.7' }, // averageSessionDuration (seconds)
      ],
    },
  ],
} as RunReportResponse;

describe('mapOverview', () => {
  it('maps the six v2 metrics including newUsers and averageSessionDuration', () => {
    const o = mapOverview(overviewResp);
    expect(o.activeUsers).toBe(42);
    expect(o.newUsers).toBe(17);
    expect(o.sessions).toBe(55);
    expect(o.pageViews).toBe(198);
    expect(o.engagementRate).toBeCloseTo(0.5432);
    expect(o.averageSessionDuration).toBeCloseTo(154.7);
  });

  it('empty/missing rows → zeros and null engagement', () => {
    const o = mapOverview({} as RunReportResponse);
    expect(o).toEqual({
      activeUsers: 0,
      newUsers: 0,
      sessions: 0,
      pageViews: 0,
      engagementRate: null,
      averageSessionDuration: 0,
    });
  });

  it('corrupt metric strings fall back to 0', () => {
    const o = mapOverview({
      rows: [{ metricValues: [{ value: 'NaN?' }, {}, { value: '3' }] }],
    } as RunReportResponse);
    expect(o.activeUsers).toBe(0);
    expect(o.newUsers).toBe(0);
    expect(o.sessions).toBe(3);
  });
});

describe('mapTrend + fillTrendGaps', () => {
  it('converts YYYYMMDD to ISO and sorts ascending', () => {
    const t = mapTrend({
      rows: [
        { dimensionValues: [{ value: '20260726' }], metricValues: [{ value: '2' }, { value: '3' }] },
        { dimensionValues: [{ value: '20260724' }], metricValues: [{ value: '1' }, { value: '1' }] },
      ],
    } as RunReportResponse);
    expect(t.map((p) => p.date)).toEqual(['2026-07-24', '2026-07-26']);
  });

  it('fills missing days with zeros across the whole range', () => {
    const today = new Date('2026-07-27T12:00:00Z');
    const filled = fillTrendGaps(
      [{ date: '2026-07-25', activeUsers: 5, sessions: 6 }],
      '7d',
      today,
    );
    expect(filled).toHaveLength(8); // 7daysAgo..today inclusive
    expect(filled[0].date).toBe('2026-07-20');
    expect(filled.at(-1)!.date).toBe('2026-07-27');
    expect(filled.find((p) => p.date === '2026-07-25')).toEqual({
      date: '2026-07-25',
      activeUsers: 5,
      sessions: 6,
    });
    expect(filled.filter((p) => p.activeUsers === 0)).toHaveLength(7);
  });

  it('completely empty input → all-zero line', () => {
    const filled = fillTrendGaps([], '30d', new Date('2026-07-27T00:00:00Z'));
    expect(filled).toHaveLength(31);
    expect(filled.every((p) => p.activeUsers === 0 && p.sessions === 0)).toBe(true);
  });
});

describe('mapEvents — key detection via the keyEvents metric, no hardcoded names', () => {
  it('marks isKeyEvent only when key events were actually counted', () => {
    const events = mapEvents({
      rows: [
        { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '90' }, { value: '0' }] },
        { dimensionValues: [{ value: 'purchase' }], metricValues: [{ value: '4' }, { value: '4' }] },
        { dimensionValues: [{ value: 'scroll' }], metricValues: [{ value: '12' }, { value: '0' }] },
      ],
    } as RunReportResponse);
    expect(events.map((e) => e.eventName)).toEqual(['page_view', 'scroll', 'purchase']);
    expect(events.map((e) => e.isKeyEvent)).toEqual([false, false, true]);
    expect(events[2]).toEqual({
      eventName: 'purchase',
      eventCount: 4,
      keyEventCount: 4,
      isKeyEvent: true,
    });
  });

  it('defensively aggregates duplicate eventName rows: both metrics summed', () => {
    const events = mapEvents({
      rows: [
        { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '49' }, { value: '0' }] },
        { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '8' }, { value: '0' }] },
        { dimensionValues: [{ value: 'purchase' }], metricValues: [{ value: '1' }, { value: '0' }] },
        { dimensionValues: [{ value: 'purchase' }], metricValues: [{ value: '2' }, { value: '2' }] },
      ],
    } as RunReportResponse);
    expect(events).toEqual([
      { eventName: 'page_view', eventCount: 57, keyEventCount: 0, isKeyEvent: false },
      { eventName: 'purchase', eventCount: 3, keyEventCount: 2, isKeyEvent: true },
    ]);
  });

  it('equal counts sort deterministically by name (tiebreaker)', () => {
    const events = mapEvents({
      rows: [
        { dimensionValues: [{ value: 'login' }], metricValues: [{ value: '5' }, { value: '0' }] },
        { dimensionValues: [{ value: 'click' }], metricValues: [{ value: '5' }, { value: '0' }] },
      ],
    } as RunReportResponse);
    expect(events.map((e) => e.eventName)).toEqual(['click', 'login']);
  });
});

describe('mapCountries', () => {
  it('labels known ISO codes in Hebrew and falls back to the raw id', () => {
    const rows = mapCountries({
      rows: [
        { dimensionValues: [{ value: 'IL' }], metricValues: [{ value: '9' }] },
        { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '1' }] },
      ],
    } as RunReportResponse);
    expect(rows[0].label).toBe('ישראל');
    expect(rows[1].label).toBe('(not set)');
  });
});

describe('mapRealtime', () => {
  it('maps the three responses and filters unset/empty events and locations', () => {
    const snap = mapRealtime(
      { rows: [{ metricValues: [{ value: '3' }] }] },
      {
        rows: [
          { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '5' }] },
          { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '2' }] },
          { dimensionValues: [{ value: '' }], metricValues: [{ value: '1' }] },
        ],
      },
      {
        rows: [
          { dimensionValues: [{ value: 'Tel Aviv' }], metricValues: [{ value: '2' }] },
          { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '1' }] },
          { dimensionValues: [{ value: '   ' }], metricValues: [{ value: '1' }] },
        ],
      },
    );
    expect(snap.activeUsersNow).toBe(3);
    expect(snap.topEvents).toEqual([{ eventName: 'page_view', count: 5 }]);
    expect(snap.topLocations).toEqual([{ label: 'Tel Aviv', activeUsers: 2 }]);
  });

  it('empty responses → zero snapshot', () => {
    const snap = mapRealtime({}, {}, {});
    expect(snap).toEqual({ activeUsersNow: 0, topEvents: [], topLocations: [] });
  });
});

describe('mapQuota', () => {
  it('maps consumed/remaining and returns null when absent', () => {
    expect(mapQuota(undefined)).toBeNull();
    expect(mapQuota({})).toBeNull();
    expect(
      mapQuota({ tokensPerDay: { consumed: 10, remaining: 90 }, tokensPerHour: { consumed: 1, remaining: 9 } }),
    ).toEqual({
      tokensPerDay: { consumed: 10, remaining: 90 },
      tokensPerHour: { consumed: 1, remaining: 9 },
    });
  });
});

describe('classifyGa4Error', () => {
  it('quota: gRPC code 8, HTTP 429, or RESOURCE_EXHAUSTED text', () => {
    expect(classifyGa4Error({ code: 8 })).toBe('quota');
    expect(classifyGa4Error({ status: 429 })).toBe('quota');
    expect(classifyGa4Error({ message: 'Quota exceeded: RESOURCE_EXHAUSTED' })).toBe('quota');
  });

  it('auth: codes 7/16 or HTTP 401/403', () => {
    expect(classifyGa4Error({ code: 7 })).toBe('auth');
    expect(classifyGa4Error({ code: 16 })).toBe('auth');
    expect(classifyGa4Error({ status: 401 })).toBe('auth');
    expect(classifyGa4Error({ status: 403 })).toBe('auth');
  });

  it('network: fetch TypeError or connection errors', () => {
    expect(classifyGa4Error(Object.assign(new TypeError('fetch failed')))).toBe('network');
    expect(classifyGa4Error({ message: 'getaddrinfo ENOTFOUND analyticsdata.googleapis.com' })).toBe(
      'network',
    );
  });

  it('anything else: unknown', () => {
    expect(classifyGa4Error({})).toBe('unknown');
    expect(classifyGa4Error('boom')).toBe('unknown');
    expect(classifyGa4Error(null)).toBe('unknown');
  });
});

describe('formatSeconds', () => {
  it('formats seconds, minutes and hours in readable Hebrew', () => {
    expect(formatSeconds(0)).toBe("0 שנ'");
    expect(formatSeconds(45)).toBe("45 שנ'");
    expect(formatSeconds(154)).toBe("2:34 דק'");
    expect(formatSeconds(3725)).toBe("1:02:05 שע'");
  });
});
