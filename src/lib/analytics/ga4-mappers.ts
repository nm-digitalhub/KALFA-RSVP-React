// Pure GA4 response mappers — defensive against empty/partial responses
// (missing rows → [], metric values arrive as strings → Number with a 0
// fallback). No I/O; everything here is unit-testable in the node env.
import {
  CHANNEL_GROUP_LABELS,
  DEVICE_LABELS,
  rangeDayCount,
  type AnalyticsOverview,
  type AnalyticsRange,
  type ApiPropertyQuota,
  type ChannelRow,
  type CountryRow,
  type DeviceRow,
  type EventCountRow,
  type QuotaSnapshot,
  type RealtimeSnapshot,
  type RunRealtimeReportResponse,
  type RunReportResponse,
  type SourceRow,
  type TopPageRow,
  type TrendPoint,
} from './ga4-types';

type AnyReportResponse = RunReportResponse | RunRealtimeReportResponse;

function num(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rows(resp: AnyReportResponse | null | undefined) {
  return resp?.rows ?? [];
}

function dim(row: { dimensionValues?: { value?: string | null }[] | null }, i: number): string {
  return row.dimensionValues?.[i]?.value ?? '';
}

function met(row: { metricValues?: { value?: string | null }[] | null }, i: number): number {
  return num(row.metricValues?.[i]?.value);
}

// Metric order contract: buildCoreBatchA report #1.
export function mapOverview(resp: RunReportResponse | null | undefined): AnalyticsOverview {
  const row = rows(resp)[0];
  const sessions = row ? met(row, 2) : 0;
  return {
    activeUsers: row ? met(row, 0) : 0,
    newUsers: row ? met(row, 1) : 0,
    sessions,
    pageViews: row ? met(row, 3) : 0,
    engagementRate: sessions > 0 && row ? met(row, 4) : null,
    averageSessionDuration: row ? met(row, 5) : 0,
  };
}

// GA returns dates as YYYYMMDD in the property's timezone.
export function mapTrend(resp: RunReportResponse | null | undefined): TrendPoint[] {
  return rows(resp)
    .map((row) => {
      const raw = dim(row, 0);
      const iso =
        raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      return { date: iso, activeUsers: met(row, 0), sessions: met(row, 1) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// GA omits days with zero activity; a new property would render a broken
// line without this. Fills every calendar day of the range with zeros.
export function fillTrendGaps(
  points: TrendPoint[],
  range: AnalyticsRange,
  today: Date,
): TrendPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p]));
  const days = rangeDayCount(range);
  const out: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push(byDate.get(iso) ?? { date: iso, activeUsers: 0, sessions: 0 });
  }
  return out;
}

export function mapTopPages(resp: RunReportResponse | null | undefined): TopPageRow[] {
  return rows(resp).map((row) => ({
    pagePath: dim(row, 0),
    pageTitle: dim(row, 1),
    views: met(row, 0),
  }));
}

export function mapChannels(resp: RunReportResponse | null | undefined): ChannelRow[] {
  return rows(resp).map((row) => {
    const channelGroup = dim(row, 0);
    return {
      channelGroup,
      label: CHANNEL_GROUP_LABELS[channelGroup] ?? channelGroup,
      sessions: met(row, 0),
    };
  });
}

export function mapSources(resp: RunReportResponse | null | undefined): SourceRow[] {
  return rows(resp).map((row) => ({
    source: dim(row, 0),
    medium: dim(row, 1),
    sessions: met(row, 0),
  }));
}

// Region names in Hebrew via Intl; unknown/invalid ids fall back to the id.
const regionNames = new Intl.DisplayNames(['he'], { type: 'region' });

export function mapCountries(resp: RunReportResponse | null | undefined): CountryRow[] {
  return rows(resp).map((row) => {
    const countryId = dim(row, 0);
    let label = countryId;
    if (/^[A-Z]{2}$/.test(countryId)) {
      try {
        label = regionNames.of(countryId) ?? countryId;
      } catch {
        label = countryId;
      }
    }
    return { countryId, label, activeUsers: met(row, 0) };
  });
}

export function mapDevices(resp: RunReportResponse | null | undefined): DeviceRow[] {
  return rows(resp).map((row) => {
    const category = dim(row, 0);
    return {
      category,
      label: DEVICE_LABELS[category] ?? category,
      sessions: met(row, 0),
    };
  });
}

// Metric order contract: buildCoreBatchB report #3 → [eventCount, keyEvents].
// The star derives from the keyEvents METRIC: isKeyEvent === "key events were
// actually counted for this event in the selected range" (keyEventCount > 0),
// NOT "marked as key in Admin today". Defensive aggregation by eventName (sums
// both metrics) guards against any future dimension-induced row splits; sort
// is deterministic — count desc, then name, so equal counts don't shuffle.
export function mapEvents(resp: RunReportResponse | null | undefined): EventCountRow[] {
  const byName = new Map<string, EventCountRow>();
  for (const row of rows(resp)) {
    const eventName = dim(row, 0);
    if (!eventName) continue;
    const eventCount = met(row, 0);
    const keyEventCount = met(row, 1);
    const existing = byName.get(eventName);
    if (existing) {
      existing.eventCount += eventCount;
      existing.keyEventCount += keyEventCount;
      existing.isKeyEvent = existing.keyEventCount > 0;
    } else {
      byName.set(eventName, {
        eventName,
        eventCount,
        keyEventCount,
        isKeyEvent: keyEventCount > 0,
      });
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.eventCount - a.eventCount || a.eventName.localeCompare(b.eventName),
  );
}

// Argument order contract: buildRealtimeRequests() → [active, events, locations].
export function mapRealtime(
  activeResp: RunRealtimeReportResponse | null | undefined,
  eventsResp: RunRealtimeReportResponse | null | undefined,
  locationsResp: RunRealtimeReportResponse | null | undefined,
): RealtimeSnapshot {
  const active = rows(activeResp)[0];
  return {
    activeUsersNow: active ? met(active, 0) : 0,
    topEvents: rows(eventsResp)
      .map((row) => ({ eventName: dim(row, 0), count: met(row, 0) }))
      .filter((e) => e.eventName && e.eventName !== '(not set)'),
    // City labels are cleaned BEFORE reaching the UI: empty and '(not set)'
    // rows never render. GA additionally applies its own privacy thresholding
    // upstream on sparse geo data.
    topLocations: rows(locationsResp)
      .map((row) => ({ label: dim(row, 0).trim(), activeUsers: met(row, 0) }))
      .filter((l) => l.label && l.label !== '(not set)'),
  };
}

export function mapQuota(quota: ApiPropertyQuota | null | undefined): QuotaSnapshot | null {
  if (!quota?.tokensPerDay && !quota?.tokensPerHour) return null;
  const part = (p?: { consumed?: number | null; remaining?: number | null } | null) => ({
    consumed: p?.consumed ?? 0,
    remaining: p?.remaining ?? 0,
  });
  return {
    tokensPerDay: part(quota?.tokensPerDay),
    tokensPerHour: part(quota?.tokensPerHour),
  };
}

// ---- error classification ----
export type Ga4ErrorKind = 'quota' | 'auth' | 'network' | 'unknown';

// Deliberately defensive: under fallback:'rest', gax surfaces GoogleError with
// gRPC-scale numeric codes (RESOURCE_EXHAUSTED=8, PERMISSION_DENIED=7,
// UNAUTHENTICATED=16); raw HTTP layers may surface 429/401/403; and transport
// failures arrive as fetch TypeErrors. All shapes are covered.
export function classifyGa4Error(err: unknown): Ga4ErrorKind {
  const e = err as { code?: unknown; status?: unknown; message?: unknown; name?: unknown } | null;
  const code = typeof e?.code === 'number' ? e.code : null;
  const status = typeof e?.status === 'number' ? e.status : null;
  const message = typeof e?.message === 'string' ? e.message : '';

  if (code === 8 || status === 429 || message.includes('RESOURCE_EXHAUSTED')) return 'quota';
  if (code === 7 || code === 16 || status === 401 || status === 403) return 'auth';
  if (
    e?.name === 'TypeError' ||
    /fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)
  ) {
    return 'network';
  }
  return 'unknown';
}

// ---- duration formatting (Hebrew, readable) ----
export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} שנ'`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)} שע'`;
  return `${minutes}:${pad(seconds)} דק'`;
}
