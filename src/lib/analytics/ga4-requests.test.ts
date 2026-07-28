import { describe, expect, it } from 'vitest';

import {
  buildCoreBatchA,
  buildCoreBatchB,
  buildCoreBatchC,
  buildCoreBatchD,
  buildRealtimeRequests,
} from './ga4-requests';
import {
  FUNNEL_EVENTS,
  parseRange,
  rangeDayCount,
  rangeToDateRange,
  rangeToPreviousDateRange,
  type AnalyticsRange,
} from './ga4-types';

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

  it('previous period is the equal-length period immediately before', () => {
    expect(rangeToPreviousDateRange('today')).toEqual({
      startDate: 'yesterday',
      endDate: 'yesterday',
    });
    expect(rangeToPreviousDateRange('7d')).toEqual({
      startDate: '15daysAgo',
      endDate: '8daysAgo',
    });
    expect(rangeToPreviousDateRange('30d')).toEqual({
      startDate: '61daysAgo',
      endDate: '31daysAgo',
    });
    expect(rangeToPreviousDateRange('90d')).toEqual({
      startDate: '181daysAgo',
      endDate: '91daysAgo',
    });
  });
});

describe('buildCoreBatchA', () => {
  it('contains exactly 5 reports with quota on the first only', () => {
    const reqs = buildCoreBatchA('30d');
    expect(reqs).toHaveLength(5);
    expect(reqs[0].returnPropertyQuota).toBe(true);
    expect(reqs.slice(1).every((r) => !r.returnPropertyQuota)).toBe(true);
  });

  it('ONLY the overview report is dual-range (current + previous); the rest are single-range', () => {
    for (const range of ALL_RANGES) {
      const reqs = buildCoreBatchA(range);
      expect(reqs[0].dateRanges).toEqual([
        rangeToDateRange(range),
        rangeToPreviousDateRange(range),
      ]);
      for (const req of reqs.slice(1)) {
        expect(req.dateRanges).toEqual([rangeToDateRange(range)]);
      }
    }
  });

  it('overview report carries the seven v3 metrics in contract order', () => {
    const names = buildCoreBatchA('7d')[0].metrics?.map((m) => m.name);
    expect(names).toEqual([
      'activeUsers',
      'newUsers',
      'sessions',
      'screenPageViews',
      'engagementRate',
      'averageSessionDuration',
      'purchaseRevenue',
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
  it('contains exactly 5 reports (the batch cap) with quota on the first only', () => {
    const reqs = buildCoreBatchB('30d');
    expect(reqs).toHaveLength(5);
    expect(reqs[0].returnPropertyQuota).toBe(true);
    expect(reqs.slice(1).every((r) => !r.returnPropertyQuota)).toBe(true);
  });

  it('events report detects key events via the keyEvents METRIC — no name allowlist, no flag dimension', () => {
    const events = buildCoreBatchB('30d')[2];
    expect(events.dimensions?.map((d) => d.name)).toEqual(['eventName']);
    expect(events.metrics?.map((m) => m.name)).toEqual(['eventCount', 'keyEvents']);
    expect(JSON.stringify(events)).not.toContain('sign_up');
  });

  it('funnel report filters to exactly the FUNNEL_EVENTS names via inListFilter', () => {
    const funnel = buildCoreBatchB('30d')[3];
    expect(funnel.dimensions?.map((d) => d.name)).toEqual(['eventName']);
    expect(funnel.metrics?.map((m) => m.name)).toEqual(['eventCount']);
    expect(funnel.dimensionFilter?.filter?.fieldName).toBe('eventName');
    expect(funnel.dimensionFilter?.filter?.inListFilter?.values).toEqual(
      FUNNEL_EVENTS.map((e) => e.name),
    );
  });

  it('404 report filters by pageTitle CONTAINS 404 and returns pagePath views', () => {
    const notFound = buildCoreBatchB('30d')[4];
    expect(notFound.dimensions?.map((d) => d.name)).toEqual(['pagePath']);
    expect(notFound.metrics?.map((m) => m.name)).toEqual(['screenPageViews']);
    expect(notFound.dimensionFilter?.filter?.fieldName).toBe('pageTitle');
    expect(notFound.dimensionFilter?.filter?.stringFilter).toEqual({
      matchType: 'CONTAINS',
      value: '404',
    });
  });
});

describe('buildCoreBatchC', () => {
  it('contains exactly 4 reports with quota on the first only', () => {
    const reqs = buildCoreBatchC('30d');
    expect(reqs).toHaveLength(4);
    expect(reqs[0].returnPropertyQuota).toBe(true);
    expect(reqs.slice(1).every((r) => !r.returnPropertyQuota)).toBe(true);
  });

  it('covers the Signals demographics + landing pages in contract order', () => {
    const dims = buildCoreBatchC('7d').map((r) => r.dimensions?.map((d) => d.name));
    expect(dims).toEqual([
      ['userAgeBracket'],
      ['userGender'],
      ['brandingInterest'],
      ['landingPage'],
    ]);
  });

  it('derives dateRanges from the given range', () => {
    for (const range of ALL_RANGES) {
      for (const req of buildCoreBatchC(range)) {
        expect(req.dateRanges).toEqual([rangeToDateRange(range)]);
      }
    }
  });
});

describe('buildCoreBatchD — custom-dimension breakdowns + KALFA channel group', () => {
  it('without a channel-group id: exactly 2 reports, quota on the first only', () => {
    const reqs = buildCoreBatchD('30d');
    expect(reqs).toHaveLength(2);
    expect(reqs[0].returnPropertyQuota).toBe(true);
    expect(reqs[0].dimensions?.map((d) => d.name)).toEqual(['customEvent:lead_source']);
    expect(reqs[0].metrics?.map((m) => m.name)).toEqual(['eventCount']);
    expect(reqs[1].returnPropertyQuota).toBeUndefined();
    expect(reqs[1].dimensions?.map((d) => d.name)).toEqual(['customEvent:billing_model']);
    expect(reqs[1].metrics?.map((m) => m.name)).toEqual(['purchaseRevenue']);
  });

  it('with a channel-group id: a 3rd report on sessionCustomChannelGroup:<id>', () => {
    const reqs = buildCoreBatchD('30d', undefined, '15331180408');
    expect(reqs).toHaveLength(3);
    expect(reqs[2].dimensions?.map((d) => d.name)).toEqual([
      'sessionCustomChannelGroup:15331180408',
    ]);
    expect(reqs[2].metrics?.map((m) => m.name)).toEqual(['sessions']);
  });

  it('stream scoping applies to every batch-D report', () => {
    const SID = '15330155015';
    for (const req of buildCoreBatchD('7d', SID, '15331180408')) {
      expect(req.dimensionFilter?.filter?.fieldName).toBe('streamId');
    }
  });
});

describe('stream scoping — every report is pinned to the beta stream when a streamId is given', () => {
  const SID = '15330155015';
  const streamLeaf = {
    filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: SID } },
  };

  it('reports WITHOUT an existing filter get the plain stream filter (all batches + realtime)', () => {
    const plain = [
      ...buildCoreBatchA('30d', SID).filter((_, i) => i !== 2),
      buildCoreBatchB('30d', SID)[0],
      buildCoreBatchB('30d', SID)[1],
      buildCoreBatchB('30d', SID)[2],
      ...buildCoreBatchC('30d', SID),
      ...buildRealtimeRequests(SID),
    ];
    for (const req of plain) expect(req.dimensionFilter).toEqual(streamLeaf);
  });

  it('reports WITH an existing filter get andGroup [stream, existing]', () => {
    const topPages = buildCoreBatchA('30d', SID)[2];
    const funnel = buildCoreBatchB('30d', SID)[3];
    const notFound = buildCoreBatchB('30d', SID)[4];
    for (const req of [topPages, funnel, notFound]) {
      const and = req.dimensionFilter?.andGroup?.expressions;
      expect(and).toHaveLength(2);
      expect(and?.[0]).toEqual(streamLeaf);
      expect(and?.[1]).toBeDefined();
    }
    // the pre-existing filters survive intact inside the andGroup
    expect(
      topPages.dimensionFilter?.andGroup?.expressions?.[1]?.notExpression,
    ).toBeDefined();
    expect(
      funnel.dimensionFilter?.andGroup?.expressions?.[1]?.filter?.inListFilter?.values,
    ).toEqual(FUNNEL_EVENTS.map((e) => e.name));
  });

  it('no streamId → no filter added anywhere (backwards compatible)', () => {
    expect(buildCoreBatchA('30d')[0].dimensionFilter).toBeUndefined();
    expect(buildCoreBatchB('30d')[0].dimensionFilter).toBeUndefined();
    expect(buildCoreBatchC('30d')[0].dimensionFilter).toBeUndefined();
    expect(buildRealtimeRequests()[0].dimensionFilter).toBeUndefined();
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
