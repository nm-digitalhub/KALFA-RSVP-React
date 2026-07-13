import type { Metadata } from 'next';
import Link from 'next/link';
import { formatIsraelDateTime } from '@/lib/date';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getEventStats, type EventStatsResult } from '@/lib/data/event-stats';
import { requireEventAccess } from '@/lib/data/events';
import { EVENT_STATUS_LABELS, CAMPAIGN_STATUS_LABELS } from '@/lib/data/event-labels';
import { StatsRefreshButton } from './stats-refresh-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'סטטיסטיקות אירוע',
};

function SectionCard({
  title,
  state,
  children,
}: {
  title: string;
  state: EventStatsResult['totalsState'] | EventStatsResult['eventState'] | EventStatsResult['campaign']['state'];
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {state === 'error' ? (
          <Badge variant="destructive">שגיאה בטעינה</Badge>
        ) : null}
        {state === 'permission_limited' ? (
          <Badge variant="secondary">אין הרשאה להציג</Badge>
        ) : null}
      </div>
      {state === 'permission_limited' ? (
        <p className="text-sm text-muted-foreground">אין לך הרשאה לצפות בנתונים אלו.</p>
      ) : state === 'error' ? (
        <p className="text-sm text-muted-foreground">לא ניתן היה לטעון את הנתונים כרגע. נסה לרענן.</p>
      ) : (
        children
      )}
    </section>
  );
}

function PercentBar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export default async function EventStatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Mandatory page gate — throws notFound() if reports.view is absent.
  await requireEventAccess(id, 'reports', 'view');
  const stats = await getEventStats(id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/app/events/${id}`}
            className={buttonVariants({ variant: 'ghost' })}
          >
            ← חזרה לאירוע
          </Link>
          <h1 className="mt-2 text-2xl font-bold">סטטיסטיקות אירוע</h1>
        </div>
        <StatsRefreshButton />
      </div>

      {/* Event header */}
      <SectionCard title="פרטי האירוע" state={stats.eventState}>
        {stats.event ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">שם</dt>
              <dd className="font-medium">{stats.event.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">סטטוס</dt>
              <dd className="font-medium">
                {stats.event.status ? EVENT_STATUS_LABELS[stats.event.status] : '—'}
              </dd>
            </div>
            {stats.event.eventDate ? (
              <div>
                <dt className="text-muted-foreground">תאריך</dt>
                <dd className="font-medium">{formatIsraelDateTime(stats.event.eventDate) || 'לא נקבע תאריך'}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </SectionCard>

      {/* RSVP / headcount */}
      <SectionCard title="הזמנות ותשובות (RSVP)" state={stats.totalsState}>
        {stats.totals ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">סה״כ מוזמנים</dt>
                <dd className="text-xl font-bold">{stats.totals.invited_people}</dd>
                <p className="text-xs text-muted-foreground">{stats.totals.rows} רשומות</p>
              </div>
              <div>
                <dt className="text-muted-foreground">מגיעים</dt>
                <dd className="text-xl font-bold text-success">{stats.totals.attending_people}</dd>
                <p className="text-xs text-muted-foreground">{stats.totals.attending_rows} רשומות</p>
              </div>
              <div>
                <dt className="text-muted-foreground">לא מגיעים</dt>
                <dd className="text-xl font-bold text-destructive">{stats.totals.declined_rows}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">לא החליטו</dt>
                <dd className="text-xl font-bold text-warning">{stats.totals.maybe_rows}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">ממתינים</dt>
                <dd className="text-xl font-bold">{stats.totals.pending_rows}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">חריגה מהמשוער</dt>
                <dd className="text-xl font-bold">{stats.totals.over_invited_rows}</dd>
              </div>
            </dl>
            {stats.percentages ? (
              <div className="space-y-2">
                <PercentBar label="שיעור תגובה" value={stats.percentages.responseRate} />
                <PercentBar label="שיעור הגעה (שורות)" value={stats.percentages.attendingRate} />
                <PercentBar
                  label="שיעור הגעה (אנשים)"
                  value={stats.percentages.attendingPeopleRate}
                />
              </div>
            ) : null}
            <Link
              href={`/app/events/${id}/guests`}
              className={buttonVariants({ variant: 'outline' })}
            >
              ניהול מוזמנים
            </Link>
          </div>
        ) : null}
      </SectionCard>

      {/* Campaign operational + delivery + billing */}
      <SectionCard title="קמפיין יצירת הקשר" state={stats.campaign.state}>
        {stats.campaign.id ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">סטטוס</dt>
                <dd className="font-medium">
                  {stats.campaign.status ? CAMPAIGN_STATUS_LABELS[stats.campaign.status] : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">מגעים מקסימליים</dt>
                <dd className="font-medium">{stats.campaign.maxContacts ?? '—'}</dd>
              </div>
              {stats.campaign.reachedCount != null ? (
                <div>
                  <dt className="text-muted-foreground">נוצר קשר (הגעה)</dt>
                  <dd className="font-medium">{stats.campaign.reachedCount}</dd>
                </div>
              ) : null}
            </dl>
            {stats.campaign.delivery ? (
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">נשלח</dt>
                  <dd className="font-medium">{stats.campaign.delivery.sent}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">נמסר</dt>
                  <dd className="font-medium">{stats.campaign.delivery.delivered}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">נקרא</dt>
                  <dd className="font-medium">{stats.campaign.delivery.read}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">נכשל</dt>
                  <dd className="font-medium text-destructive">{stats.campaign.delivery.failed}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">מספר שגוי</dt>
                  <dd className="font-medium text-warning">{stats.campaign.delivery.wrongNumber}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">ביקש הסרה</dt>
                  <dd className="font-medium">{stats.campaign.delivery.optedOut}</dd>
                </div>
              </div>
            ) : null}
            {stats.campaign.billing ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">נוצר קשר (לחיוב)</dt>
                  <dd className="font-medium">{stats.campaign.billing.reachedCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">נצבר</dt>
                  <dd className="font-medium">{stats.campaign.billing.accrued}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">תקרה</dt>
                  <dd className="font-medium">{stats.campaign.billing.ceiling}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">מגעים מקסימליים</dt>
                  <dd className="font-medium">{stats.campaign.billing.maxContacts}</dd>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      {/* Alerts */}
      {stats.alerts.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">התראות</h2>
          <ul className="space-y-1 text-sm">
            {stats.alerts.map((a) => (
              <li key={a.id} className="rounded bg-muted px-3 py-2">
                {a.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
