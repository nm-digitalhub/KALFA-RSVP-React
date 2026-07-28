import { describe, expect, it } from 'vitest';

import {
  classifyGa4Error,
  fillTrendGaps,
  formatSeconds,
  mapCountries,
  mapDemographic,
  mapEvents,
  mapFunnel,
  mapBillingModels,
  mapGenders,
  mapKalfaChannels,
  mapLandingPages,
  mapLeadSources,
  mapNotFound,
  mapOverview,
  mapQuota,
  mapRealtime,
  mapTrend,
} from './ga4-mappers';
import type { RunReportResponse } from './ga4-types';

// Dual-dateRange response: the API adds an implicit dateRange dimension —
// rows are matched by its VALUE ('date_range_0'/'date_range_1'), never by
// array position (previous listed first here on purpose).
const overviewResp = {
  rows: [
    {
      dimensionValues: [{ value: 'date_range_1' }],
      metricValues: [
        { value: '10' }, // activeUsers (previous)
        { value: '5' },
        { value: '20' },
        { value: '80' },
        { value: '0.25' },
        { value: '60' },
        { value: '0' },
      ],
    },
    {
      dimensionValues: [{ value: 'date_range_0' }],
      metricValues: [
        { value: '42' }, // activeUsers
        { value: '17' }, // newUsers
        { value: '55' }, // sessions
        { value: '198' }, // screenPageViews
        { value: '0.5432' }, // engagementRate
        { value: '154.7' }, // averageSessionDuration (seconds)
        { value: '204' }, // purchaseRevenue (ILS)
      ],
    },
  ],
} as RunReportResponse;

describe('mapOverview', () => {
  it('splits current/previous by the implicit dateRange dimension value, not row order', () => {
    const o = mapOverview(overviewResp);
    expect(o.current.activeUsers).toBe(42);
    expect(o.current.newUsers).toBe(17);
    expect(o.current.sessions).toBe(55);
    expect(o.current.pageViews).toBe(198);
    expect(o.current.engagementRate).toBeCloseTo(0.5432);
    expect(o.current.averageSessionDuration).toBeCloseTo(154.7);
    expect(o.current.purchaseRevenue).toBe(204);
    expect(o.previous?.activeUsers).toBe(10);
    expect(o.previous?.purchaseRevenue).toBe(0);
  });

  it('single row without a dateRange dimension → current from it, previous null', () => {
    const o = mapOverview({
      rows: [{ metricValues: [{ value: '7' }] }],
    } as RunReportResponse);
    expect(o.current.activeUsers).toBe(7);
    expect(o.previous).toBeNull();
  });

  it('empty/missing rows → zeros, null engagement, null previous', () => {
    const o = mapOverview({} as RunReportResponse);
    expect(o).toEqual({
      current: {
        activeUsers: 0,
        newUsers: 0,
        sessions: 0,
        pageViews: 0,
        engagementRate: null,
        averageSessionDuration: 0,
        purchaseRevenue: 0,
      },
      previous: null,
    });
  });

  it('corrupt metric strings fall back to 0', () => {
    const o = mapOverview({
      rows: [{ metricValues: [{ value: 'NaN?' }, {}, { value: '3' }] }],
    } as RunReportResponse);
    expect(o.current.activeUsers).toBe(0);
    expect(o.current.newUsers).toBe(0);
    expect(o.current.sessions).toBe(3);
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

describe('mapFunnel', () => {
  it('returns every funnel step in journey order with 0 defaults for missing events', () => {
    const steps = mapFunnel({
      rows: [
        { dimensionValues: [{ value: 'generate_lead' }], metricValues: [{ value: '6' }] },
        { dimensionValues: [{ value: 'sign_up' }], metricValues: [{ value: '4' }] },
      ],
    } as RunReportResponse);
    expect(steps.map((s) => s.name)).toEqual([
      'sign_up',
      'generate_lead',
      'agreement_signed',
      'payment_authorized',
      'purchase',
    ]);
    expect(steps.map((s) => s.count)).toEqual([4, 6, 0, 0, 0]);
    expect(steps[0].label).toBe('הרשמות');
  });

  it('empty response → all-zero funnel, never a missing step', () => {
    const steps = mapFunnel({} as RunReportResponse);
    expect(steps).toHaveLength(5);
    expect(steps.every((s) => s.count === 0)).toBe(true);
  });
});

describe('mapNotFound', () => {
  it('maps pagePath views and drops unset rows', () => {
    const rows = mapNotFound({
      rows: [
        { dimensionValues: [{ value: '/no-such-page' }], metricValues: [{ value: '3' }] },
        { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '1' }] },
        { dimensionValues: [{ value: '' }], metricValues: [{ value: '9' }] },
      ],
    } as RunReportResponse);
    expect(rows).toEqual([{ pagePath: '/no-such-page', views: 3 }]);
  });
});

describe('mapDemographic / mapGenders / mapLandingPages', () => {
  it('drops (not set), applies labels when given, falls back to the raw key', () => {
    const resp = {
      rows: [
        { dimensionValues: [{ value: '25-34' }], metricValues: [{ value: '8' }] },
        { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '2' }] },
      ],
    } as RunReportResponse;
    expect(mapDemographic(resp)).toEqual([{ key: '25-34', label: '25-34', activeUsers: 8 }]);
  });

  it('genders get Hebrew labels with raw fallback for unknown keys', () => {
    const rows = mapGenders({
      rows: [
        { dimensionValues: [{ value: 'female' }], metricValues: [{ value: '5' }] },
        { dimensionValues: [{ value: 'male' }], metricValues: [{ value: '3' }] },
        { dimensionValues: [{ value: 'other' }], metricValues: [{ value: '1' }] },
      ],
    } as RunReportResponse);
    expect(rows.map((r) => r.label)).toEqual(['נשים', 'גברים', 'other']);
  });

  it('landing pages map sessions and drop unset rows', () => {
    const rows = mapLandingPages({
      rows: [
        { dimensionValues: [{ value: '/' }], metricValues: [{ value: '12' }] },
        { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '1' }] },
      ],
    } as RunReportResponse);
    expect(rows).toEqual([{ landingPage: '/', sessions: 12 }]);
  });
});

describe('v4 custom-dimension mappers', () => {
  it('lead sources: Hebrew labels, (not set)/empty rows dropped (live-verified shape)', () => {
    const rows = mapLeadSources({
      rows: [
        { dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '59' }] },
        { dimensionValues: [{ value: '' }], metricValues: [{ value: '35' }] },
        { dimensionValues: [{ value: 'contact_form' }], metricValues: [{ value: '1' }] },
        { dimensionValues: [{ value: 'callback_request' }], metricValues: [{ value: '2' }] },
      ],
    } as never);
    expect(rows).toEqual([
      { key: 'contact_form', label: 'טופס יצירת קשר', count: 1 },
      { key: 'callback_request', label: 'בקשת חזרה', count: 2 },
    ]);
  });

  it('billing models: labels + revenue, unknown keys pass through raw', () => {
    const rows = mapBillingModels({
      rows: [
        { dimensionValues: [{ value: 'base_overage' }], metricValues: [{ value: '204' }] },
        { dimensionValues: [{ value: 'legacy' }], metricValues: [{ value: '12' }] },
      ],
    } as never);
    expect(rows[0]).toEqual({ key: 'base_overage', label: 'בסיס + חריגה', revenue: 204 });
    expect(rows[1].label).toBe('legacy');
  });

  it('kalfa channels: default channels translated, custom Hebrew names pass through', () => {
    const rows = mapKalfaChannels({
      rows: [
        { dimensionValues: [{ value: 'Direct' }], metricValues: [{ value: '11' }] },
        { dimensionValues: [{ value: 'וואטסאפ' }], metricValues: [{ value: '3' }] },
      ],
    } as never);
    expect(rows[0].label).toBe('ישיר');
    expect(rows[1].label).toBe('וואטסאפ');
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
