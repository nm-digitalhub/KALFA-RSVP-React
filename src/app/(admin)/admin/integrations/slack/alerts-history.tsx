import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { OpsAlertEntry } from '@/lib/data/admin/alerts';
import type { PageResult } from '@/lib/data/admin/shared';

import { EmptyState, Pagination, formatDateTime } from '../../_components';

// The alert log, lifted out of alerts/page.tsx so both surfaces render ONE
// definition while both exist (the Task 0.3/0.4 pattern).
//
// `basePath` is a prop rather than a constant for the reason the lift exists:
// the page it came from hardcoded '/admin/alerts' in Pagination, so copying it
// unchanged would have sent a reader on page 2 of the NEW page back to the page
// being retired. A render test that asserts text does not catch an href.

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
  customer_inquiry: 'פניות לקוחות',
};

function levelClass(level: string): string {
  if (level === 'error') return 'text-red-700';
  if (level === 'warn') return 'text-amber-700';
  return 'text-sky-700';
}

export function AlertsHistory({
  alerts,
  basePath,
}: {
  alerts: PageResult<OpsAlertEntry>;
  basePath: string;
}) {
  return (
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
        basePath={basePath}
        page={alerts.page}
        pageSize={alerts.pageSize}
        total={alerts.total}
      />
    </section>
  );
}
