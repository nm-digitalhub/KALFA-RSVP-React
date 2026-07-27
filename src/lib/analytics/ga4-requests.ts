// Pure GA4 request builders — no I/O, no property id (the DAL injects it at
// the batch level), fully parametric in the selected range. Report order
// inside each batch is a CONTRACT the mappers rely on (documented per batch).
import {
  EVENTS_ROW_LIMIT,
  REALTIME_LIST_LIMIT,
  TABLE_ROW_LIMIT,
  rangeToDateRange,
  type AnalyticsRange,
  type RunRealtimeReportRequest,
  type RunReportRequest,
} from './ga4-types';

// Token surfaces must never surface in reports — defense-in-depth on top of
// the (site) route-group exclusion (the tag never runs there to begin with).
const EXCLUDED_PATH_PREFIXES = ['/r/', '/g/', '/ty/', '/join/'] as const;

function excludeTokenPaths(): RunReportRequest['dimensionFilter'] {
  return {
    notExpression: {
      orGroup: {
        expressions: EXCLUDED_PATH_PREFIXES.map((prefix) => ({
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'BEGINS_WITH', value: prefix },
          },
        })),
      },
    },
  };
}

function metricDesc(metric: string): NonNullable<RunReportRequest['orderBys']> {
  return [{ metric: { metricName: metric }, desc: true }];
}

// Batch A order: [overview, trend, topPages, channels, sources]
export function buildCoreBatchA(range: AnalyticsRange): RunReportRequest[] {
  const dateRanges = [rangeToDateRange(range)];
  return [
    {
      // returnPropertyQuota on the FIRST report of the batch — the DAL reads
      // the core-pool quota from this report's response.
      returnPropertyQuota: true,
      dateRanges,
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
      ],
    },
    {
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    },
    {
      dateRanges,
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [{ name: 'screenPageViews' }],
      dimensionFilter: excludeTokenPaths(),
      orderBys: metricDesc('screenPageViews'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [{ name: 'sessions' }],
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
  ];
}

// Batch B order: [geo, devices, events]
export function buildCoreBatchB(range: AnalyticsRange): RunReportRequest[] {
  const dateRanges = [rangeToDateRange(range)];
  return [
    {
      returnPropertyQuota: true,
      dateRanges,
      dimensions: [{ name: 'countryId' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: metricDesc('activeUsers'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      // The keyEvents METRIC (not the isKeyEvent dimension) marks key events:
      // a real count, no hardcoded names, and no per-flag row splitting (the
      // dimension variant returned '(not set)' splits — verified live).
      dateRanges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'keyEvents' }],
      orderBys: metricDesc('eventCount'),
      limit: EVENTS_ROW_LIMIT,
    },
  ];
}

// Realtime has no official batch endpoint — three parallel calls under one
// cache slot. Order: [activeUsers, topEvents, topLocations].
export function buildRealtimeRequests(): RunRealtimeReportRequest[] {
  return [
    { returnPropertyQuota: true, metrics: [{ name: 'activeUsers' }] },
    {
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      orderBys: metricDesc('eventCount'),
      limit: REALTIME_LIST_LIMIT,
    },
    {
      dimensions: [{ name: 'city' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: metricDesc('activeUsers'),
      limit: REALTIME_LIST_LIMIT,
    },
  ];
}
