import 'server-only';

import {
  loadAnalyticsDashboard,
  loadRealtimeSnapshot,
} from '@/lib/analytics/ga4-dashboard';
import type {
  AnalyticsDashboard,
  AnalyticsRange,
  RealtimeResult,
} from '@/lib/analytics/ga4-types';
import { hasPlatformPermission, requirePlatformStaff } from '@/lib/auth/dal';

// Admin GA4 dashboard DAL: authorization, then the request-free loader.
//
// The safe-config gate, the per-process cache (per-range core slots, one
// realtime slot, single-flight, quota backoff, stale-on-failure) and every
// mapper live in src/lib/analytics/ga4-dashboard.ts, moved there unchanged so
// the owner WhatsApp agent runs the same request and mapper as this page. This module keeps the gate: requirePlatformStaff, then
// view_customer_data. Failures NEVER throw out of here — they map to
// per-section states so one broken source cannot take down the page.

export async function getAnalyticsDashboard(
  range: AnalyticsRange,
): Promise<AnalyticsDashboard | null> {
  await requirePlatformStaff();
  if (!(await hasPlatformPermission('view_customer_data'))) return null;
  return loadAnalyticsDashboard(range);
}

export async function getRealtimeSnapshot(): Promise<RealtimeResult> {
  await requirePlatformStaff();
  if (!(await hasPlatformPermission('view_customer_data'))) {
    return { section: { state: 'error', data: null, fetchedAt: null }, quota: null };
  }
  return loadRealtimeSnapshot();
}
