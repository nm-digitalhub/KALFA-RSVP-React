import 'server-only';

import type { AnalyticsRange, Sectioned, SectionState } from '@/lib/analytics/ga4-types';
import {
  getSearchConsoleConfigStatus,
  getSearchConsoleSiteUrl,
  querySearchAnalytics,
  rangeToSearchConsoleDates,
  SearchConsoleQuotaError,
  type SearchAnalyticsApiRow,
  type SearchConsoleConfigIssue,
} from '@/lib/analytics/search-console';
import { hasPlatformPermission, requirePlatformStaff } from '@/lib/auth/dal';

// Search Console DAL. Same contract as the GA4 dashboard DAL next door:
// authorization → safe-config gate → cached fetch, and failures NEVER throw
// out of here — they become per-section states so one broken source cannot
// take the analytics page down.

export interface SearchConsoleTotals {
  clicks: number;
  impressions: number;
  ctr: number | null; // 0–1; null when there were no impressions
  position: number | null; // average; null when there were no impressions
}

export interface SearchConsoleRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleDashboard {
  configured: boolean;
  configIssue?: SearchConsoleConfigIssue;
  /** The window actually queried — it ends ~2 days back, never today. */
  window: { startDate: string; endDate: string };
  totals: Sectioned<SearchConsoleTotals>;
  queries: Sectioned<SearchConsoleRow[]>;
  pages: Sectioned<SearchConsoleRow[]>;
}

interface CacheSlot<T> {
  value: { data: T; at: number } | null;
  inflight: Promise<T> | null;
  quotaBlockedUntil: number;
}

// Search Console data only changes once a day, so a short TTL buys nothing and
// a long one keeps the page snappy. Quota here is generous, but the backoff
// still exists so a refresh loop cannot hammer a 429.
const TTL_MS = 30 * 60_000;
const QUOTA_BACKOFF_MS = 5 * 60_000;

const slots = new Map<string, CacheSlot<SearchAnalyticsApiRow[]>>();

function slotFor(key: string): CacheSlot<SearchAnalyticsApiRow[]> {
  let slot = slots.get(key);
  if (!slot) {
    slot = { value: null, inflight: null, quotaBlockedUntil: 0 };
    slots.set(key, slot);
  }
  return slot;
}

interface Outcome {
  state: Extract<SectionState, 'ok' | 'stale' | 'quota_exhausted' | 'error'>;
  rows: SearchAnalyticsApiRow[] | null;
  at: number | null;
}

async function fetchCached(
  key: string,
  fetcher: () => Promise<SearchAnalyticsApiRow[]>,
): Promise<Outcome> {
  const slot = slotFor(key);
  const now = Date.now();

  if (slot.value && now - slot.value.at < TTL_MS) {
    return { state: 'ok', rows: slot.value.data, at: slot.value.at };
  }
  if (now < slot.quotaBlockedUntil) {
    return slot.value
      ? { state: 'stale', rows: slot.value.data, at: slot.value.at }
      : { state: 'quota_exhausted', rows: null, at: null };
  }

  try {
    // single-flight: concurrent renders share one in-flight API call.
    slot.inflight ??= fetcher();
    const rows = await slot.inflight;
    slot.value = { data: rows, at: Date.now() };
    return { state: 'ok', rows, at: slot.value.at };
  } catch (err) {
    if (err instanceof SearchConsoleQuotaError) {
      slot.quotaBlockedUntil = Date.now() + QUOTA_BACKOFF_MS;
      return slot.value
        ? { state: 'stale', rows: slot.value.data, at: slot.value.at }
        : { state: 'quota_exhausted', rows: null, at: null };
    }
    // A failed fetch is never cached — the next request retries. With a last
    // good value present the section serves 'stale' rather than an error.
    return slot.value
      ? { state: 'stale', rows: slot.value.data, at: slot.value.at }
      : { state: 'error', rows: null, at: null };
  } finally {
    slot.inflight = null;
  }
}

function section<T>(outcome: Outcome, map: (rows: SearchAnalyticsApiRow[]) => T): Sectioned<T> {
  return {
    state: outcome.state,
    data: outcome.rows === null ? null : map(outcome.rows),
    fetchedAt: outcome.at === null ? null : new Date(outcome.at).toISOString(),
  };
}

function mapTotals(rows: SearchAnalyticsApiRow[]): SearchConsoleTotals {
  // A dimensionless query returns at most one row; no rows at all means the
  // site drew no impressions in the window, which is a real zero, not an error.
  const r = rows[0];
  const impressions = Math.round(r?.impressions ?? 0);
  return {
    clicks: Math.round(r?.clicks ?? 0),
    impressions,
    ctr: impressions > 0 ? (r?.ctr ?? 0) : null,
    position: impressions > 0 ? (r?.position ?? 0) : null,
  };
}

function mapRows(rows: SearchAnalyticsApiRow[]): SearchConsoleRow[] {
  return rows
    .map((r) => ({
      key: r.keys?.[0] ?? '',
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }))
    .filter((r) => r.key !== '');
}

const EMPTY: Sectioned<never> = { state: 'not_configured', data: null, fetchedAt: null };

/**
 * Organic-search panel for /admin/analytics.
 *
 * Returns null when the caller may not see customer data — the page renders
 * the same "no permission" state it already renders for GA4.
 */
export async function getSearchConsoleDashboard(
  range: AnalyticsRange,
): Promise<SearchConsoleDashboard | null> {
  await requirePlatformStaff();
  if (!(await hasPlatformPermission('view_customer_data'))) return null;

  const window = rangeToSearchConsoleDates(range);

  const config = await getSearchConsoleConfigStatus();
  if (!config.ok) {
    return {
      configured: false,
      configIssue: config.issue,
      window,
      totals: EMPTY,
      queries: EMPTY,
      pages: EMPTY,
    };
  }

  // Non-null after the gate above; kept explicit so a future refactor of the
  // gate cannot silently produce a request with an empty property.
  const siteUrl = getSearchConsoleSiteUrl() ?? '';

  const base = { siteUrl, startDate: window.startDate, endDate: window.endDate };
  const [totals, queries, pages] = await Promise.all([
    fetchCached(`totals:${range}`, () => querySearchAnalytics({ ...base, rowLimit: 1 })),
    fetchCached(`queries:${range}`, () =>
      querySearchAnalytics({ ...base, dimensions: ['query'], rowLimit: 15 }),
    ),
    fetchCached(`pages:${range}`, () =>
      querySearchAnalytics({ ...base, dimensions: ['page'], rowLimit: 15 }),
    ),
  ]);

  return {
    configured: true,
    window,
    totals: section(totals, mapTotals),
    queries: section(queries, mapRows),
    pages: section(pages, mapRows),
  };
}
