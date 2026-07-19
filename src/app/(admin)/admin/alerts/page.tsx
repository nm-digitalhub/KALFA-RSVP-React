import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSlackAlertsView, listOpsAlerts } from '@/lib/data/admin/alerts';
import {
  EmptyState,
  PageHeading,
  Pagination,
  formatDateTime,
  parsePageParam,
} from '../_components';
import { AlertsClient } from './alerts-client';

// Admin: Slack operational-alerting configuration + history. requirePlatformPermission('manage_settings') is
// enforced in the data layer (and the /admin layout). The bot token is NEVER
// passed to the browser — getSlackAlertsView() returns only a `hasToken` boolean.

const LEVEL_LABEL: Record<string, string> = {
  error: 'שגיאה',
  warn: 'אזהרה',
  info: 'מידע',
};

const CATEGORY_LABEL: Record<string, string> = {
  errors: 'שגיאות מערכת',
  send_health: 'תקינות שליחה',
  campaign_billing: 'קמפיינים וחיוב',
  security: 'אבטחה',
};

function levelClass(level: string): string {
  if (level === 'error') return 'text-red-700';
  if (level === 'warn') return 'text-amber-700';
  return 'text-sky-700';
}

export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePageParam((await searchParams).page);
  const [view, alerts] = await Promise.all([
    getSlackAlertsView(),
    listOpsAlerts({ page }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeading>התראות תפעול (Slack)</PageHeading>

      <AlertsClient view={view} />

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">התראות אחרונות</h2>
          <p className="text-sm text-muted-foreground">
            יומן ההתראות שנשלחו (או שניסינו לשלוח), מהחדש לישן.
          </p>
        </div>

        {alerts.items.length === 0 ? (
          <EmptyState>לא נשלחו התראות עדיין.</EmptyState>
        ) : (
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow className="text-xs text-muted-foreground">
                <TableHead>רמה</TableHead>
                <TableHead>כותרת</TableHead>
                <TableHead>מקור</TableHead>
                <TableHead>קטגוריה</TableHead>
                <TableHead>נשלח</TableHead>
                <TableHead>זמן</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className={`font-medium ${levelClass(a.level)}`}>
                    {LEVEL_LABEL[a.level] ?? a.level}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {a.title}
                    {a.suppressed_count > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        (+{a.suppressed_count})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.source ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.category ? CATEGORY_LABEL[a.category] ?? a.category : '—'}
                  </TableCell>
                  <TableCell>
                    {a.delivered ? (
                      <span className="text-emerald-600">✓</span>
                    ) : (
                      <span className="text-red-700">✗</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(a.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Pagination
          basePath="/admin/alerts"
          page={alerts.page}
          pageSize={alerts.pageSize}
          total={alerts.total}
        />
      </section>
    </div>
  );
}
