import 'server-only';

import { getGa4Client } from '@/lib/analytics/ga4-client';
import {
  getGa4ConfigStatus,
  getGa4ChannelGroupId,
  getGa4Property,
  getGa4StreamId,
} from '@/lib/analytics/ga4-config';
import {
  classifyGa4Error,
  fillTrendGaps,
  mapChannels,
  mapCountries,
  mapDemographic,
  mapDevices,
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
  mapSources,
  mapTopPages,
  mapTrend,
} from '@/lib/analytics/ga4-mappers';
import {
  buildCoreBatchA,
  buildCoreBatchB,
  buildCoreBatchC,
  buildCoreBatchD,
  buildRealtimeRequests,
} from '@/lib/analytics/ga4-requests';
import type {
  AnalyticsDashboard,
  AnalyticsRange,
  QuotaSnapshot,
  RealtimeResult,
  RealtimeSnapshot,
  RunReportResponse,
  RunRealtimeReportResponse,
  SectionState,
  Sectioned,
} from '@/lib/analytics/ga4-types';
import { hasPlatformPermission, requireAdmin } from '@/lib/auth/dal';

// Admin GA4 dashboard DAL: authorization → safe-config gate → cached fetch.
// Failures NEVER throw out of here — they map to per-section states so one
// broken source cannot take down the page (stats-page SectionCard pattern).
//
// Cache design (alerts-config.ts variant, v2 plan §3.5):
// - Core slots are keyed by `${batch}:${range}` — ranges never overwrite each
//   other; realtime is a single range-independent slot.
// - PER-PROCESS memory: not shared across Node instances. Today kalfa-beta is
//   a single pm2 fork, so there is exactly one cache in practice; a future
//   multi-instance deploy just means one cache per instance (fine for
//   aggregate, non-personalized data).
// - A successful fetch is cached for the TTL; a FAILED fetch is never cached
//   (next request retries) — except quota errors, which set a short backoff so
//   page refreshes cannot hammer a 429 that will keep failing for up to an
//   hour anyway. With lastGood present, failures serve 'stale'.
// - single-flight: concurrent renders share one in-flight API call.

interface CoreData {
  responses: RunReportResponse[];
  quota: QuotaSnapshot | null;
}

interface RealtimeData {
  snapshot: RealtimeSnapshot;
  quota: QuotaSnapshot | null;
}

interface CacheSlot<T> {
  value: { data: T; at: number } | null;
  inflight: Promise<T> | null;
  quotaBlockedUntil: number;
}

const CORE_TTL_MS = 5 * 60_000;
const REALTIME_TTL_MS = 45_000;
const QUOTA_BACKOFF_MS = 60_000;

const coreSlots = new Map<string, CacheSlot<CoreData>>();
const realtimeSlot: CacheSlot<RealtimeData> = {
  value: null,
  inflight: null,
  quotaBlockedUntil: 0,
};

function coreSlot(key: string): CacheSlot<CoreData> {
  let slot = coreSlots.get(key);
  if (!slot) {
    slot = { value: null, inflight: null, quotaBlockedUntil: 0 };
    coreSlots.set(key, slot);
  }
  return slot;
}

interface FetchOutcome<T> {
  state: Extract<SectionState, 'ok' | 'stale' | 'quota_exhausted' | 'error'>;
  data: T | null;
  at: number | null;
}

async function fetchCached<T>(
  slot: CacheSlot<T>,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<FetchOutcome<T>> {
  const now = Date.now();

  if (slot.value && now - slot.value.at < ttlMs) {
    return { state: 'ok', data: slot.value.data, at: slot.value.at };
  }

  // Inside a quota backoff window: don't touch the API at all.
  if (now < slot.quotaBlockedUntil) {
    return slot.value
      ? { state: 'stale', data: slot.value.data, at: slot.value.at }
      : { state: 'quota_exhausted', data: null, at: null };
  }

  try {
    const inflight = (slot.inflight ??= fetcher());
    const data = await inflight;
    // Only the flight owner records; concurrent awaiters see the same result.
    if (slot.inflight === inflight) {
      slot.value = { data, at: Date.now() };
      slot.inflight = null;
    }
    return { state: 'ok', data, at: slot.value?.at ?? Date.now() };
  } catch (err) {
    slot.inflight = null;
    const kind = classifyGa4Error(err);
    // Ops visibility only — classified kind + truncated message. Never request
    // payloads, tokens, or paths (the message from gax carries none of those).
    console.error(
      '[admin-analytics] GA4 fetch failed:',
      kind,
      err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 120),
    );
    if (kind === 'quota') {
      slot.quotaBlockedUntil = Date.now() + QUOTA_BACKOFF_MS;
    }
    if (slot.value) {
      return { state: 'stale', data: slot.value.data, at: slot.value.at };
    }
    return kind === 'quota'
      ? { state: 'quota_exhausted', data: null, at: null }
      : { state: 'error', data: null, at: null };
  }
}

function sectioned<T, D>(
  outcome: FetchOutcome<T>,
  pick: (data: T) => D,
): Sectioned<D> {
  return {
    state: outcome.state,
    data: outcome.data === null ? null : pick(outcome.data),
    fetchedAt: outcome.at === null ? null : new Date(outcome.at).toISOString(),
  };
}

function notConfigured<T>(): Sectioned<T> {
  return { state: 'not_configured', data: null, fetchedAt: null };
}

async function fetchCoreBatch(
  requests: ReturnType<typeof buildCoreBatchA>,
): Promise<CoreData> {
  const client = getGa4Client();
  const [response] = await client.batchRunReports({
    property: getGa4Property(),
    requests,
  });
  const responses = (response.reports ?? []) as RunReportResponse[];
  return { responses, quota: mapQuota(responses[0]?.propertyQuota) };
}

export async function getAnalyticsDashboard(
  range: AnalyticsRange,
): Promise<AnalyticsDashboard | null> {
  await requireAdmin();
  if (!(await hasPlatformPermission('view_customer_data'))) return null;

  const config = await getGa4ConfigStatus();
  if (!config.ok) {
    return {
      configured: false,
      configIssue: config.issue,
      range,
      overview: notConfigured(),
      trend: notConfigured(),
      topPages: notConfigured(),
      channels: notConfigured(),
      sources: notConfigured(),
      geo: notConfigured(),
      devices: notConfigured(),
      events: notConfigured(),
      funnel: notConfigured(),
      notFound: notConfigured(),
      ages: notConfigured(),
      genders: notConfigured(),
      interests: notConfigured(),
      landingPages: notConfigured(),
      leadSources: notConfigured(),
      billingModels: notConfigured(),
      kalfaChannels: notConfigured(),
      coreQuota: null,
    };
  }

  const streamId = getGa4StreamId();
  const channelGroupId = getGa4ChannelGroupId();
  const [a, b, c, dBatch] = await Promise.all([
    fetchCached(coreSlot(`A:${range}`), CORE_TTL_MS, () =>
      fetchCoreBatch(buildCoreBatchA(range, streamId)),
    ),
    fetchCached(coreSlot(`B:${range}`), CORE_TTL_MS, () =>
      fetchCoreBatch(buildCoreBatchB(range, streamId)),
    ),
    fetchCached(coreSlot(`C:${range}`), CORE_TTL_MS, () =>
      fetchCoreBatch(buildCoreBatchC(range, streamId)),
    ),
    fetchCached(coreSlot(`D:${range}`), CORE_TTL_MS, () =>
      fetchCoreBatch(buildCoreBatchD(range, streamId, channelGroupId)),
    ),
  ]);

  return {
    configured: true,
    configIssue: null,
    range,
    // Batch A report order contract: [overview, trend, topPages, channels, sources]
    overview: sectioned(a, (d) => mapOverview(d.responses[0])),
    trend: sectioned(a, (d) => fillTrendGaps(mapTrend(d.responses[1]), range, new Date())),
    topPages: sectioned(a, (d) => mapTopPages(d.responses[2])),
    channels: sectioned(a, (d) => mapChannels(d.responses[3])),
    sources: sectioned(a, (d) => mapSources(d.responses[4])),
    // Batch B report order contract: [geo, devices, events, funnel, notFound]
    geo: sectioned(b, (d) => mapCountries(d.responses[0])),
    devices: sectioned(b, (d) => mapDevices(d.responses[1])),
    events: sectioned(b, (d) => mapEvents(d.responses[2])),
    funnel: sectioned(b, (d) => mapFunnel(d.responses[3])),
    notFound: sectioned(b, (d) => mapNotFound(d.responses[4])),
    // Batch C report order contract: [ages, genders, interests, landingPages]
    ages: sectioned(c, (d) => mapDemographic(d.responses[0])),
    genders: sectioned(c, (d) => mapGenders(d.responses[1])),
    interests: sectioned(c, (d) => mapDemographic(d.responses[2])),
    landingPages: sectioned(c, (d) => mapLandingPages(d.responses[3])),
    // Batch D report order contract: [leadSources, billingModels, kalfaChannels?]
    leadSources: sectioned(dBatch, (d) => mapLeadSources(d.responses[0])),
    billingModels: sectioned(dBatch, (d) => mapBillingModels(d.responses[1])),
    kalfaChannels: channelGroupId
      ? sectioned(dBatch, (d) => mapKalfaChannels(d.responses[2]))
      : notConfigured(),
    coreQuota: a.data?.quota ?? b.data?.quota ?? c.data?.quota ?? dBatch.data?.quota ?? null,
  };
}

export async function getRealtimeSnapshot(): Promise<RealtimeResult> {
  await requireAdmin();
  if (!(await hasPlatformPermission('view_customer_data'))) {
    return { section: { state: 'error', data: null, fetchedAt: null }, quota: null };
  }
  const config = await getGa4ConfigStatus();
  if (!config.ok) return { section: notConfigured(), quota: null };

  const outcome = await fetchCached(realtimeSlot, REALTIME_TTL_MS, async () => {
    const client = getGa4Client();
    const property = getGa4Property();
    const [active, events, locations] = await Promise.all(
      buildRealtimeRequests(getGa4StreamId()).map(async (request) => {
        const [response] = await client.runRealtimeReport({ property, ...request });
        return response as RunRealtimeReportResponse;
      }),
    );
    return {
      snapshot: mapRealtime(active, events, locations),
      quota: mapQuota(active?.propertyQuota),
    };
  });

  return {
    section: sectioned(outcome, (d) => d.snapshot),
    quota: outcome.data?.quota ?? null,
  };
}
