import { Clock3, Eye, Gauge, TrendingUp, UserPlus, Users } from 'lucide-react';

import { EmptyState, PageHeading, formatDateTime } from '../_components';
import { AutoRefresh } from './_auto-refresh';
import { RangePicker } from './_range-picker';
import {
  DataTable,
  EngagementMeter,
  NotConfiguredCard,
  QuotaBanner,
  RealtimeCard,
  SectionCard,
  StatTile,
} from './_sections';
import { TrendChart } from './_trend-chart';
import { formatSeconds } from '@/lib/analytics/ga4-mappers';
import { RANGE_OPTIONS, parseRange } from '@/lib/analytics/ga4-types';
import {
  getAnalyticsDashboard,
  getRealtimeSnapshot,
} from '@/lib/data/admin/analytics';

// Admin GA4 dashboard. Server component end-to-end except the trend chart and
// the refresh timer; every GA4 call happens in the DAL behind requireAdmin +
// hasPlatformPermission('view_customer_data') + the safe-config gate.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'אנליטיקת אתר' };

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseRange((await searchParams).range);
  const [dash, realtime] = await Promise.all([
    getAnalyticsDashboard(range),
    getRealtimeSnapshot(),
  ]);

  if (dash === null) {
    return (
      <div className="space-y-8">
        <PageHeading>אנליטיקת אתר</PageHeading>
        <EmptyState>אין לך הרשאה לצפות בנתונים אלה.</EmptyState>
      </div>
    );
  }

  if (!dash.configured) {
    return (
      <div className="space-y-8">
        <PageHeading>אנליטיקת אתר</PageHeading>
        <NotConfiguredCard issue={dash.configIssue} />
      </div>
    );
  }

  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;
  const overview = dash.overview.data;
  // Exhaustive: the banner shows only when SOME section is quota-blocked.
  const quotaHit = [
    dash.overview,
    dash.trend,
    dash.topPages,
    dash.channels,
    dash.sources,
    dash.geo,
    dash.devices,
    dash.events,
    realtime,
  ].some((s) => s.state === 'quota_exhausted');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeading>אנליטיקת אתר</PageHeading>
        <RangePicker current={range} />
      </div>

      {quotaHit ? <QuotaBanner quota={dash.coreQuota} /> : null}

      <SectionCard title={`מדדים מרכזיים — ${rangeLabel}`} section={dash.overview}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatTile label="משתמשים פעילים" value={overview?.activeUsers ?? 0} icon={Users} />
          <StatTile label="משתמשים חדשים" value={overview?.newUsers ?? 0} icon={UserPlus} />
          <StatTile label="ביקורים" value={overview?.sessions ?? 0} icon={TrendingUp} />
          <StatTile label="צפיות בעמודים" value={overview?.pageViews ?? 0} icon={Eye} />
          <StatTile
            label="משך ביקור ממוצע"
            value={formatSeconds(overview?.averageSessionDuration ?? 0)}
            icon={Clock3}
          />
          <StatTile
            label="שיעור מעורבות"
            value={
              overview?.engagementRate === null || overview === null
                ? '—'
                : `${Math.round((overview?.engagementRate ?? 0) * 100)}%`
            }
            icon={Gauge}
            extra={<EngagementMeter rate={overview?.engagementRate ?? null} />}
          />
        </div>
      </SectionCard>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title={`מגמה — ${rangeLabel}`} section={dash.trend}>
            {range === 'today' ? (
              <EmptyState>גרף מגמה זמין בטווח רב-יומי (7 / 30 / 90 ימים).</EmptyState>
            ) : (
              <TrendChart points={dash.trend.data ?? []} />
            )}
          </SectionCard>
        </div>
        <RealtimeCard realtime={realtime} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <SectionCard title="עמודים מובילים" section={dash.topPages}>
          <DataTable
            headers={['עמוד', 'כותרת', 'צפיות']}
            rows={(dash.topPages.data ?? []).map((r) => ({
              key: r.pagePath,
              cells: [r.pagePath, r.pageTitle, r.views],
            }))}
            emptyText="אין נתוני עמודים בטווח הזה עדיין."
          />
        </SectionCard>

        <SectionCard title="ערוצי תנועה" section={dash.channels}>
          <DataTable
            headers={['ערוץ', 'ביקורים']}
            rows={(dash.channels.data ?? []).map((r) => ({
              key: r.channelGroup,
              cells: [r.label, r.sessions],
            }))}
            emptyText="אין נתוני ערוצים בטווח הזה עדיין."
          />
        </SectionCard>

        <SectionCard title="מקורות תנועה" section={dash.sources}>
          <DataTable
            headers={['מקור', 'אמצעי', 'ביקורים']}
            rows={(dash.sources.data ?? []).map((r) => ({
              key: `${r.source}/${r.medium}`,
              cells: [r.source, r.medium, r.sessions],
            }))}
            emptyText="אין נתוני מקורות בטווח הזה עדיין."
          />
        </SectionCard>

        <SectionCard title="מדינות" section={dash.geo}>
          <DataTable
            headers={['מדינה', 'משתמשים פעילים']}
            rows={(dash.geo.data ?? []).map((r) => ({
              key: r.countryId,
              cells: [r.label, r.activeUsers],
            }))}
            emptyText="אין נתוני מדינות בטווח הזה עדיין."
          />
        </SectionCard>

        <SectionCard title="מכשירים" section={dash.devices}>
          <DataTable
            headers={['סוג מכשיר', 'ביקורים']}
            rows={(dash.devices.data ?? []).map((r) => ({
              key: r.category,
              cells: [r.label, r.sessions],
            }))}
            emptyText="אין נתוני מכשירים בטווח הזה עדיין."
          />
        </SectionCard>

        <SectionCard title="אירועים" section={dash.events}>
          <DataTable
            headers={['אירוע', 'ספירה']}
            rows={(dash.events.data ?? []).map((r) => ({
              key: r.eventName,
              cells: [r.isKeyEvent ? `★ ${r.eventName}` : r.eventName, r.eventCount],
            }))}
            emptyText="אין נתוני אירועים בטווח הזה עדיין."
          />
          <p className="text-xs text-muted-foreground">
            ★ = נספרו אירועי-מפתח לאירוע זה בטווח הנבחר
          </p>
        </SectionCard>
      </div>

      <p className="text-xs text-muted-foreground">
        {dash.overview.fetchedAt ? `עודכן ב-${formatDateTime(dash.overview.fetchedAt)}. ` : ''}
        הנתונים נאספים בהסכמה בלבד ואינם כוללים את דפי האורחים.
      </p>

      <AutoRefresh />
    </div>
  );
}
