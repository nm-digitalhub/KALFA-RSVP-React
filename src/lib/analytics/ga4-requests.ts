// Pure GA4 request builders — no I/O, no property id (the DAL injects it at
// the batch level), fully parametric in the selected range. Report order
// inside each batch is a CONTRACT the mappers rely on (documented per batch).
import {
  EVENTS_ROW_LIMIT,
  FUNNEL_EVENTS,
  REALTIME_LIST_LIMIT,
  TABLE_ROW_LIMIT,
  rangeToDateRange,
  rangeToPreviousDateRange,
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

// Pin every report to the beta stream (live-verified 27.7.2026: filtering on
// streamId without listing it as a dimension is valid, drops the deleted old
// stream's history, and is compatible with the user-scoped demographics
// reports). No streamId → no filter (backwards compatible).
function withStreamFilter(
  streamId: string | undefined,
  existing?: RunReportRequest['dimensionFilter'],
): RunReportRequest['dimensionFilter'] | undefined {
  if (!streamId) return existing;
  const stream = {
    filter: {
      fieldName: 'streamId',
      stringFilter: { matchType: 'EXACT' as const, value: streamId },
    },
  };
  return existing ? { andGroup: { expressions: [stream, existing] } } : stream;
}

// Batch A order: [overview, trend, topPages, channels, sources]
export function buildCoreBatchA(
  range: AnalyticsRange,
  streamId?: string,
): RunReportRequest[] {
  const dateRanges = [rangeToDateRange(range)];
  return [
    {
      // returnPropertyQuota on the FIRST report of the batch — the DAL reads
      // the core-pool quota from this report's response.
      // TWO dateRanges (current + the equal previous period) — the API adds
      // an implicit dateRange dimension, one row per range, powering the KPI
      // delta arrows. Only THIS report is dual-range; the tables would be
      // polluted by doubled rows.
      returnPropertyQuota: true,
      dateRanges: [rangeToDateRange(range), rangeToPreviousDateRange(range)],
      dimensionFilter: withStreamFilter(streamId),
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
        { name: 'purchaseRevenue' },
      ],
    },
    {
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    },
    {
      dateRanges,
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [{ name: 'screenPageViews' }],
      dimensionFilter: withStreamFilter(streamId, excludeTokenPaths()),
      orderBys: metricDesc('screenPageViews'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
  ];
}

// Batch B order: [geo, devices, events, funnel, notFound] (5 = the batch cap)
export function buildCoreBatchB(
  range: AnalyticsRange,
  streamId?: string,
): RunReportRequest[] {
  const dateRanges = [rangeToDateRange(range)];
  return [
    {
      returnPropertyQuota: true,
      dateRanges,
      dimensions: [{ name: 'countryId' }],
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('activeUsers'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: withStreamFilter(streamId),
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
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('eventCount'),
      limit: EVENTS_ROW_LIMIT,
    },
    {
      // v3 funnel: exact counts for the phase-1 journey events only.
      dateRanges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: withStreamFilter(streamId, {
        filter: {
          fieldName: 'eventName',
          inListFilter: { values: FUNNEL_EVENTS.map((e) => e.name) },
        },
      }),
    },
    {
      // v3 404 detector: page views whose title marks a not-found render.
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      dimensionFilter: withStreamFilter(streamId, {
        filter: {
          fieldName: 'pageTitle',
          stringFilter: { matchType: 'CONTAINS', value: '404' },
        },
      }),
      orderBys: metricDesc('screenPageViews'),
      limit: TABLE_ROW_LIMIT,
    },
  ];
}

// Batch C order: [ages, genders, interests, landingPages] — the Signals
// demographics (subject to Google's privacy thresholding; empty until data
// accrues) + landing pages.
export function buildCoreBatchC(
  range: AnalyticsRange,
  streamId?: string,
): RunReportRequest[] {
  const dateRanges = [rangeToDateRange(range)];
  return [
    {
      returnPropertyQuota: true,
      dateRanges,
      dimensions: [{ name: 'userAgeBracket' }],
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('activeUsers'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'userGender' }],
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('activeUsers'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'brandingInterest' }],
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('activeUsers'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
  ];
}

// Single-report request for landingPage — deliberately NOT the whole of
// buildCoreBatchC (which bundles 3 demographic reports ahead of this one):
// the fleet CLI's analytics-summary verb wants only this report, and paying
// for 3 discarded demographic calls on every invocation (content-seo-strategist
// runs it every week, not just once) would be pure waste. Same dimension/
// metric/filter/limit shape as buildCoreBatchC's own landingPage entry —
// kept in sync by hand since GA4 has no shared sub-request type to extract.
export function buildLandingPagesRequest(
  range: AnalyticsRange,
  streamId?: string,
): RunReportRequest[] {
  return [
    {
      dateRanges: [rangeToDateRange(range)],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
  ];
}

// Batch D order (v5): [leadSources, billingModels, campaigns, campaignLeads,
// kalfaChannels?] — the two custom-dimension breakdowns (live-verified 27.7:
// `customEvent:<param>` is the documented Data API syntax and accepted by the
// property), the campaign-performance pair (v5 — owner-run paid campaigns,
// e.g. Instagram UTM tests: `campaigns` carries sessions/users/engagement per
// sessionCampaignName+source+medium; `campaignLeads` is a SEPARATE
// eventName='generate_lead'-filtered report over the same campaignName
// dimension, joined client-side by mapCampaigns — a single report can't mix
// an eventName restriction with unfiltered session metrics), plus, ONLY when
// a channel-group id is configured, traffic by the custom "ערוצי KALFA" group
// (`sessionCustomChannelGroup:<id>` — syntax live-verified as well). 5 reports
// is the batchRunReports cap (confirmed against the official Data API
// reference: "Each batch request is allowed up to 5 requests") — exactly hit
// when channelGroupId is set.
export function buildCoreBatchD(
  range: AnalyticsRange,
  streamId?: string,
  channelGroupId?: string,
): RunReportRequest[] {
  const dateRanges = [rangeToDateRange(range)];
  const reports: RunReportRequest[] = [
    {
      returnPropertyQuota: true,
      dateRanges,
      dimensions: [{ name: 'customEvent:lead_source' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('eventCount'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [{ name: 'customEvent:billing_model' }],
      metrics: [{ name: 'purchaseRevenue' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('purchaseRevenue'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      dateRanges,
      dimensions: [
        { name: 'sessionCampaignName' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    },
    {
      // Same [campaignName, source, medium] triple as the campaigns report
      // above — a campaignName-only join would collapse distinct rows that
      // happen to share a campaign name (e.g. the same UTM campaign reused
      // across two placements with different source/medium) and double-count
      // that campaign's leads onto every row sharing the name.
      dateRanges,
      dimensions: [
        { name: 'sessionCampaignName' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: withStreamFilter(streamId, {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: 'generate_lead' },
        },
      }),
      orderBys: metricDesc('eventCount'),
      limit: TABLE_ROW_LIMIT,
    },
  ];
  if (channelGroupId) {
    reports.push({
      dateRanges,
      dimensions: [{ name: `sessionCustomChannelGroup:${channelGroupId}` }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('sessions'),
      limit: TABLE_ROW_LIMIT,
    });
  }
  return reports;
}

// Realtime has no official batch endpoint — three parallel calls under one
// cache slot. Order: [activeUsers, topEvents, topLocations].
export function buildRealtimeRequests(streamId?: string): RunRealtimeReportRequest[] {
  return [
    {
      returnPropertyQuota: true,
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: withStreamFilter(streamId),
    },
    {
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('eventCount'),
      limit: REALTIME_LIST_LIMIT,
    },
    {
      dimensions: [{ name: 'city' }],
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: withStreamFilter(streamId),
      orderBys: metricDesc('activeUsers'),
      limit: REALTIME_LIST_LIMIT,
    },
  ];
}
