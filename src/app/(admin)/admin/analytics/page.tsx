import { Banknote, Clock3, Eye, Gauge, TrendingUp, UserPlus, Users } from 'lucide-react';

import { EmptyState, PageHeading, formatDateTime } from '../_components';
import { AutoRefresh } from './_auto-refresh';
import { RangePicker } from './_range-picker';
import {
  DataTable,
  EngagementMeter,
  FunnelCard,
  NotConfiguredCard,
  QuotaBanner,
  RealtimeCard,
  SectionCard,
  StatDelta,
  StatTile,
} from './_sections';
import { TrendChart } from './_trend-chart';
import { formatSeconds } from '@/lib/analytics/ga4-mappers';
import { RANGE_OPTIONS, parseRange } from '@/lib/analytics/ga4-types';
import {
  getAnalyticsDashboard,
  getRealtimeSnapshot,
} from '@/lib/data/admin/analytics';
import { formatCurrency } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getCookieConsentPublicConfig } from '@/lib/consent/admin-config';
import { CONSENT_REVISION } from '@/lib/consent/cookie-consent-config';

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
  const [dash, realtime, consent] = await Promise.all([
    getAnalyticsDashboard(range),
    getRealtimeSnapshot(),
    getCookieConsentPublicConfig(),
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
  const cur = dash.overview.data?.current;
  const prev = dash.overview.data?.previous;
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
    dash.funnel,
    dash.notFound,
    dash.ages,
    dash.genders,
    dash.interests,
    dash.landingPages,
    dash.leadSources,
    dash.billingModels,
    dash.campaigns,
    dash.kalfaChannels,
    realtime.section,
  ].some((s) => s.state === 'quota_exhausted');

  const signalsEmptyText =
    'אין עדיין נתונים — דמוגרפיה מגיעה מ-Google Signals, נצברת ממשתמשים שהסכימו להתאמה אישית ' +
    'וכפופה לסף פרטיות של Google.';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeading>אנליטיקת אתר</PageHeading>
        <RangePicker current={range} />
      </div>

      {quotaHit ? <QuotaBanner quota={dash.coreQuota} /> : null}

      {/* v4: the collection-context strip — the numbers below only accrue
          while the consent mechanism is on and categories are offered. */}
      {!consent.enabled ? (
        <Alert variant="destructive">
          <AlertTitle>מנגנון ההסכמה כבוי — אין איסוף נתונים חדש</AlertTitle>
          <AlertDescription>
            כל עוד המנגנון כבוי (ניתן להפעילו במסך ״הסכמת עוגיות״), אף מבקר אינו
            נמדד והנתונים בדשבורד אינם מתעדכנים.
          </AlertDescription>
        </Alert>
      ) : !consent.analyticsEnabled || !consent.marketingEnabled ? (
        <Alert>
          <AlertTitle>חלק מקטגוריות ההסכמה מושבתות</AlertTitle>
          <AlertDescription>
            אנליטיקה: {consent.analyticsEnabled ? 'מוצעת' : 'מושבתת — אין מדידה'} ·
            שיווק: {consent.marketingEnabled ? 'מוצע' : 'מושבת'} · גרסת הסכמה
            בפועל: {CONSENT_REVISION + consent.revisionBump}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-xs text-muted-foreground">
          מנגנון הסכמה פעיל · אנליטיקה ושיווק מוצעות · גרסת הסכמה בפועל:{' '}
          {CONSENT_REVISION + consent.revisionBump}
        </p>
      )}

      <SectionCard title={`מדדים מרכזיים — ${rangeLabel}`} section={dash.overview}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="משתמשים פעילים"
            value={cur?.activeUsers ?? 0}
            icon={Users}
            extra={<StatDelta current={cur?.activeUsers ?? 0} previous={prev?.activeUsers} />}
          />
          <StatTile
            label="משתמשים חדשים"
            value={cur?.newUsers ?? 0}
            icon={UserPlus}
            extra={<StatDelta current={cur?.newUsers ?? 0} previous={prev?.newUsers} />}
          />
          <StatTile
            label="ביקורים"
            value={cur?.sessions ?? 0}
            icon={TrendingUp}
            extra={<StatDelta current={cur?.sessions ?? 0} previous={prev?.sessions} />}
          />
          <StatTile
            label="צפיות בעמודים"
            value={cur?.pageViews ?? 0}
            icon={Eye}
            extra={<StatDelta current={cur?.pageViews ?? 0} previous={prev?.pageViews} />}
          />
          <StatTile
            label="משך ביקור ממוצע"
            value={formatSeconds(cur?.averageSessionDuration ?? 0)}
            icon={Clock3}
            extra={
              <StatDelta
                current={cur?.averageSessionDuration ?? 0}
                previous={prev?.averageSessionDuration}
              />
            }
          />
          <StatTile
            label="הכנסות (purchase)"
            value={formatCurrency(cur?.purchaseRevenue ?? 0)}
            icon={Banknote}
            extra={
              <StatDelta current={cur?.purchaseRevenue ?? 0} previous={prev?.purchaseRevenue} />
            }
          />
          <StatTile
            label="שיעור מעורבות"
            value={
              cur?.engagementRate === null || cur === undefined
                ? '—'
                : `${Math.round((cur?.engagementRate ?? 0) * 100)}%`
            }
            icon={Gauge}
            extra={<EngagementMeter rate={cur?.engagementRate ?? null} />}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          ההשוואה היא מול תקופה קודמת שוות-אורך ({rangeLabel} שלפני הטווח הנבחר).
        </p>
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
        <FunnelCard section={dash.funnel} />

        <SectionCard title="לידים לפי מקור" section={dash.leadSources}>
          <DataTable
            headers={['מקור הליד', 'פניות']}
            rows={(dash.leadSources.data ?? []).map((r) => ({
              key: r.key,
              cells: [r.label, r.count],
            }))}
            emptyText="אין עדיין לידים בטווח הזה."
          />
        </SectionCard>

        <SectionCard title="קמפיינים" section={dash.campaigns}>
          <DataTable
            headers={['קמפיין', 'מקור / אמצעי', 'ביקורים', 'משתמשים', 'לידים', 'מעורבות']}
            rows={(dash.campaigns.data ?? []).map((r) => ({
              // composite key: the same campaign name can legitimately repeat
              // with a different source/medium (see mapCampaigns).
              key: `${r.campaignName}/${r.source}/${r.medium}`,
              cells: [
                r.campaignName,
                `${r.source} / ${r.medium}`,
                r.sessions,
                r.activeUsers,
                r.leads,
                r.engagementRate === null ? '—' : `${Math.round(r.engagementRate * 100)}%`,
              ],
            }))}
            emptyText="אין עדיין תנועה מתויגת בקמפיין (UTM) בטווח הזה."
          />
          <p className="text-xs text-muted-foreground">
            ״לידים״ נספר רק כאשר generate_lead קרה באותו ביקור שנשא את הקמפיין — ביקור חוזר
            בלי UTM (למשל כניסה ישירה ביום אחר) לא משויך לקמפיין המקורי.
          </p>
        </SectionCard>

        <SectionCard title="הכנסות לפי מודל חיוב" section={dash.billingModels}>
          <DataTable
            headers={['מודל חיוב', 'הכנסות']}
            rows={(dash.billingModels.data ?? []).map((r) => ({
              key: r.key,
              cells: [r.label, formatCurrency(r.revenue)],
            }))}
            emptyText="אין עדיין חיובים בטווח הזה — הפילוח יתמלא מגמר-החשבון הראשון."
          />
        </SectionCard>

        <SectionCard title="ערוצי KALFA" section={dash.kalfaChannels}>
          <DataTable
            headers={['ערוץ', 'ביקורים']}
            rows={(dash.kalfaChannels.data ?? []).map((r) => ({
              key: r.key,
              cells: [r.label, r.count],
            }))}
            emptyText="אין נתוני ערוצים מותאמים בטווח הזה עדיין."
          />
          <p className="text-xs text-muted-foreground">
            ערוצי ההפצה המותאמים (וואטסאפ / QR / שיחה) יתמלאו כשקישורים עם UTM
            ייצאו בפועל.
          </p>
        </SectionCard>

        <SectionCard title="עמודי נחיתה" section={dash.landingPages}>
          <DataTable
            headers={['עמוד נחיתה', 'ביקורים']}
            rows={(dash.landingPages.data ?? []).map((r) => ({
              key: r.landingPage,
              cells: [r.landingPage, r.sessions],
            }))}
            emptyText="אין נתוני עמודי נחיתה בטווח הזה עדיין."
          />
        </SectionCard>

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

        <SectionCard title="קישורים שבורים (404)" section={dash.notFound}>
          <DataTable
            headers={['עמוד', 'צפיות']}
            rows={(dash.notFound.data ?? []).map((r) => ({
              key: r.pagePath,
              cells: [r.pagePath, r.views],
            }))}
            emptyText="לא נרשמו צפיות בעמודי 404 בטווח הזה — אין קישורים שבורים ידועים."
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

        <SectionCard title="גילאים" section={dash.ages}>
          <DataTable
            headers={['קבוצת גיל', 'משתמשים פעילים']}
            rows={(dash.ages.data ?? []).map((r) => ({
              key: r.key,
              cells: [r.label, r.activeUsers],
            }))}
            emptyText={signalsEmptyText}
          />
        </SectionCard>

        <SectionCard title="מגדר" section={dash.genders}>
          <DataTable
            headers={['מגדר', 'משתמשים פעילים']}
            rows={(dash.genders.data ?? []).map((r) => ({
              key: r.key,
              cells: [r.label, r.activeUsers],
            }))}
            emptyText={signalsEmptyText}
          />
        </SectionCard>

        <SectionCard title="תחומי עניין" section={dash.interests}>
          <DataTable
            headers={['תחום עניין', 'משתמשים פעילים']}
            rows={(dash.interests.data ?? []).map((r) => ({
              key: r.key,
              cells: [r.label, r.activeUsers],
            }))}
            emptyText={signalsEmptyText}
          />
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
