// GA4 dashboard domain contracts + the range parameter (single source of
// truth for every layer: requests, cache keys, UI). API request/response
// types are NOT hand-written — they are re-exported type-only from the
// installed @google-analytics/data protos (erased at compile time, so this
// file stays safe to import from client components and tests).
import type { protos } from '@google-analytics/data';

export type RunReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest;
export type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;
export type RunRealtimeReportRequest = protos.google.analytics.data.v1beta.IRunRealtimeReportRequest;
export type RunRealtimeReportResponse = protos.google.analytics.data.v1beta.IRunRealtimeReportResponse;
export type ApiPropertyQuota = protos.google.analytics.data.v1beta.IPropertyQuota;

// ---- טווח ----
export type AnalyticsRange = 'today' | '7d' | '30d' | '90d';
export const DEFAULT_RANGE: AnalyticsRange = '30d';

export const RANGE_OPTIONS: readonly { value: AnalyticsRange; label: string }[] = [
  { value: 'today', label: 'היום' },
  { value: '7d', label: '7 ימים' },
  { value: '30d', label: '30 יום' },
  { value: '90d', label: '90 יום' },
];

const RANGE_VALUES = new Set<string>(RANGE_OPTIONS.map((o) => o.value));

// Same contract as parsePageParam (admin/_components.tsx): any invalid input —
// missing, array, unknown value — falls back to the default, never throws.
export function parseRange(raw: string | string[] | undefined): AnalyticsRange {
  if (typeof raw === 'string' && RANGE_VALUES.has(raw)) return raw as AnalyticsRange;
  return DEFAULT_RANGE;
}

export function rangeToDateRange(range: AnalyticsRange): { startDate: string; endDate: string } {
  switch (range) {
    case 'today':
      return { startDate: 'today', endDate: 'today' };
    case '7d':
      return { startDate: '7daysAgo', endDate: 'today' };
    case '90d':
      return { startDate: '90daysAgo', endDate: 'today' };
    case '30d':
      return { startDate: '30daysAgo', endDate: 'today' };
  }
}

// The immediately-preceding period of equal length, for KPI deltas (v3).
export function rangeToPreviousDateRange(
  range: AnalyticsRange,
): { startDate: string; endDate: string } {
  switch (range) {
    case 'today':
      return { startDate: 'yesterday', endDate: 'yesterday' };
    case '7d':
      return { startDate: '15daysAgo', endDate: '8daysAgo' };
    case '90d':
      return { startDate: '181daysAgo', endDate: '91daysAgo' };
    case '30d':
      return { startDate: '61daysAgo', endDate: '31daysAgo' };
  }
}

// GA's "NdaysAgo..today" span is N+1 calendar days inclusive; 'today' is 1.
export function rangeDayCount(range: AnalyticsRange): number {
  switch (range) {
    case 'today':
      return 1;
    case '7d':
      return 8;
    case '90d':
      return 91;
    case '30d':
      return 31;
  }
}

// ---- מצבי סקשן ----
// 'stale' = the refresh failed and the last good value is served with its
// original timestamp. data is non-null only for 'ok' | 'stale'.
export type SectionState = 'ok' | 'stale' | 'quota_exhausted' | 'error' | 'not_configured';

export interface Sectioned<T> {
  state: SectionState;
  data: T | null;
  fetchedAt: string | null; // ISO
}

// ---- חוזי נתונים (ערך יחיד לטווח הנבחר — אין שדות 7d/30d קבועים) ----
export interface OverviewMetrics {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  engagementRate: number | null; // 0–1; null when there are no sessions
  averageSessionDuration: number; // seconds, as returned by the API
  purchaseRevenue: number; // ILS (v3)
}

// current = the selected range; previous = the equal-length period right
// before it (KPI delta arrows). previous is null when the API returned no
// second date-range row.
export interface AnalyticsOverview {
  current: OverviewMetrics;
  previous: OverviewMetrics | null;
}

export interface TrendPoint {
  date: string; // ISO YYYY-MM-DD
  activeUsers: number;
  sessions: number;
}

export interface TopPageRow {
  pagePath: string;
  pageTitle: string;
  views: number;
}

export interface ChannelRow {
  channelGroup: string;
  label: string;
  sessions: number;
}

export interface SourceRow {
  source: string;
  medium: string;
  sessions: number;
}

export interface CountryRow {
  countryId: string;
  label: string;
  activeUsers: number;
}

export interface DeviceRow {
  category: string;
  label: string;
  sessions: number;
}

// Key-event detection rides the `keyEvents` METRIC (a real count of key
// events in the range) — never a hardcoded name allowlist, and not the
// partial isKeyEvent dimension (verified live to return '(not set)' splits).
// isKeyEvent means "key events were COUNTED for this event in the selected
// range" (keyEventCount > 0) — not necessarily "marked as key in Admin today".
export interface EventCountRow {
  eventName: string;
  eventCount: number;
  keyEventCount: number;
  isKeyEvent: boolean;
}

export interface RealtimeSnapshot {
  activeUsersNow: number;
  topEvents: { eventName: string; count: number }[];
  // Aggregate city counts only; rendered only when rows exist. "Active pages"
  // is deliberately NOT implemented — realtime has no official pagePath
  // dimension (verified against the schema); the gap is declared, not faked.
  topLocations: { label: string; activeUsers: number }[];
}

export interface QuotaSnapshot {
  tokensPerDay: { consumed: number; remaining: number };
  tokensPerHour: { consumed: number; remaining: number };
}

// ---- v3 additions ----

// Phase-1 business-event funnel, in journey order. Counts come from the
// eventCount metric filtered to exactly these names.
export const FUNNEL_EVENTS = [
  { name: 'sign_up', label: 'הרשמות' },
  { name: 'generate_lead', label: 'פניות (לידים)' },
  { name: 'agreement_signed', label: 'הסכמים שנחתמו' },
  { name: 'payment_authorized', label: 'תפיסות מסגרת' },
  { name: 'purchase', label: 'חיובים (הכנסה)' },
] as const;

export interface FunnelStep {
  name: string;
  label: string;
  count: number;
}

export interface NotFoundRow {
  pagePath: string;
  views: number;
}

export interface DemographicRow {
  key: string;
  label: string;
  activeUsers: number;
}

export interface LandingPageRow {
  landingPage: string;
  sessions: number;
}

export const GENDER_LABELS: Record<string, string> = {
  male: 'גברים',
  female: 'נשים',
  unknown: 'לא ידוע',
};

// v4 (27.7 אחה"צ): פילוחים מהמימדים המותאמים + קבוצת הערוצים של KALFA.
export const LEAD_SOURCE_LABELS: Record<string, string> = {
  contact_form: 'טופס יצירת קשר',
  callback_request: 'בקשת חזרה',
};

export const BILLING_MODEL_LABELS: Record<string, string> = {
  base_overage: 'בסיס + חריגה',
  per_reached: 'לפי אנשי קשר שהושגו',
};

export interface LabeledCountRow {
  key: string;
  label: string;
  count: number;
}

export interface BillingModelRow {
  key: string;
  label: string;
  revenue: number;
}

export type Ga4ConfigIssue =
  | 'missing_property_id'
  | 'invalid_property_id'
  | 'missing_credentials_path'
  | 'credentials_unreadable';

export interface AnalyticsDashboard {
  configured: boolean;
  configIssue: Ga4ConfigIssue | null;
  range: AnalyticsRange;
  overview: Sectioned<AnalyticsOverview>;
  trend: Sectioned<TrendPoint[]>;
  topPages: Sectioned<TopPageRow[]>;
  channels: Sectioned<ChannelRow[]>;
  sources: Sectioned<SourceRow[]>;
  geo: Sectioned<CountryRow[]>;
  devices: Sectioned<DeviceRow[]>;
  events: Sectioned<EventCountRow[]>;
  funnel: Sectioned<FunnelStep[]>; // v3 — phase-1 journey
  notFound: Sectioned<NotFoundRow[]>; // v3 — 404 detector
  ages: Sectioned<DemographicRow[]>; // v3 — Signals
  genders: Sectioned<DemographicRow[]>; // v3 — Signals
  interests: Sectioned<DemographicRow[]>; // v3 — Signals
  landingPages: Sectioned<LandingPageRow[]>; // v3
  leadSources: Sectioned<LabeledCountRow[]>; // v4 — customEvent:lead_source
  billingModels: Sectioned<BillingModelRow[]>; // v4 — customEvent:billing_model
  kalfaChannels: Sectioned<LabeledCountRow[]>; // v4 — sessionCustomChannelGroup
  coreQuota: QuotaSnapshot | null; // core and realtime pools are separate
}

// getRealtimeSnapshot v3 return: the section plus the realtime pool's own
// quota (a separate token pool from core — surfaced separately in the banner).
export interface RealtimeResult {
  section: Sectioned<RealtimeSnapshot>;
  quota: QuotaSnapshot | null;
}

export const TABLE_ROW_LIMIT = 10;
export const EVENTS_ROW_LIMIT = 15;
export const REALTIME_LIST_LIMIT = 5;

// Hebrew labels for GA4 enum values; unknown keys fall back to the raw value.
export const CHANNEL_GROUP_LABELS: Record<string, string> = {
  Direct: 'ישיר',
  'Organic Search': 'חיפוש אורגני',
  'Paid Search': 'חיפוש ממומן',
  'Organic Social': 'רשתות חברתיות',
  'Paid Social': 'רשתות חברתיות (ממומן)',
  Referral: 'הפניות',
  Email: 'אימייל',
  Display: 'מודעות תצוגה',
  'Cross-network': 'חוצה-רשתות',
  Unassigned: 'לא משויך',
};

export const DEVICE_LABELS: Record<string, string> = {
  desktop: 'מחשב',
  mobile: 'נייד',
  tablet: 'טאבלט',
};
