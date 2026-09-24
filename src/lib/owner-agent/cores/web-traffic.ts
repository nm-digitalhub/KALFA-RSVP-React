import 'server-only';

import { loadAnalyticsOverview } from '@/lib/analytics/ga4-dashboard';
import type { OverviewMetrics, SectionState } from '@/lib/analytics/ga4-types';
import type { OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for site traffic (owner-agent tool 8, web_traffic_summary;
// plan §5). Reads the GA4 overview KPIs through loadAnalyticsOverview — the
// same request, cache logic and mapper /admin/analytics uses — so the agent's
// "sessions last 7 days" is the page's number. Authorization is the caller's:
// view_customer_data, like the page (admin/analytics.ts).
//
// Unlike the database cores this one takes no Supabase client: its source is
// the GA4 Data API through the shared lazy client (ga4-client.ts). Ranges map
// one-to-one onto the page's AnalyticsRange ('today' | '7d' | '30d' are a
// subset of it), so the range semantics are GA4's calendar days in the
// property's time zone (e.g. '7d' = 7daysAgo..today), NOT the rolling windows
// of the database cores (owner-agent/range.ts). That is what keeps it equal to
// the page.
//
// Output is numbers plus a state enum. Deliberately left out:
//   - fetchedAt (a string timestamp — not needed to answer, and the output
//     contract is numbers/enums only);
//   - purchaseRevenue (money belongs under view_billing, not under the
//     view_customer_data key this tool will sit behind);
//   - every other dashboard section (pages, sources, geo, demographics) —
//     they carry text (paths, titles, campaign names), and the plan excludes
//     demographics outright.

export type WebTrafficState = SectionState;

export interface WebTrafficSummary {
  // 'ok' fresh; 'stale' last good value served after a failed refresh;
  // 'not_configured' | 'quota_exhausted' | 'error' → every metric is null.
  state: WebTrafficState;
  activeUsers: number | null;
  newUsers: number | null;
  sessions: number | null;
  pageViews: number | null;
  engagementRate: number | null; // 0–1
  averageSessionDurationSec: number | null;
  // The equal-length period right before the range (the page's delta arrows).
  previousActiveUsers: number | null;
  previousSessions: number | null;
}

function pick(m: OverviewMetrics) {
  return {
    activeUsers: m.activeUsers,
    newUsers: m.newUsers,
    sessions: m.sessions,
    pageViews: m.pageViews,
    engagementRate: m.engagementRate,
    averageSessionDurationSec: m.averageSessionDuration,
  };
}

export async function getWebTrafficSummary(range: OwnerAgentRange): Promise<WebTrafficSummary> {
  const section = await loadAnalyticsOverview(range);
  if (!section.data) {
    return {
      state: section.state,
      activeUsers: null,
      newUsers: null,
      sessions: null,
      pageViews: null,
      engagementRate: null,
      averageSessionDurationSec: null,
      previousActiveUsers: null,
      previousSessions: null,
    };
  }
  const { current, previous } = section.data;
  return {
    state: section.state,
    ...pick(current),
    previousActiveUsers: previous?.activeUsers ?? null,
    previousSessions: previous?.sessions ?? null,
  };
}
