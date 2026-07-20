import { requirePlatformPermission } from '@/lib/auth/dal';
import { listStaffAccessLog } from '@/lib/data/admin/access-log-view';
import {
  PageHeading,
  EmptyState,
  Pagination,
  Badge,
  formatDateTime,
  parsePageParam,
} from '../_components';

// Staff data-access audit: one row per targeted staff read of an identified
// customer's data — who, under which permission, whose data, when, and (for
// break-glass reads) why. Owner oversight only (gated manage_staff); shows
// metadata, never the accessed PII itself.

export default async function AdminAccessLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  // Optimistic gate; the real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_staff');
  const page = parsePageParam((await searchParams).page);
  const result = await listStaffAccessLog({ page });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <PageHeading>יומן גישת צוות</PageHeading>
        <p className="text-sm text-muted-foreground">
          כל צפייה של איש צוות בנתוני לקוח מזוהה — מי, תחת איזו הרשאה, בנתוני מי,
          ומתי. תצוגת מטא-דאטה בלבד; תוכן הנתונים עצמם לעולם אינו נשמר כאן.
        </p>
      </div>

      {result.items.length === 0 ? (
        <EmptyState>אין עדיין רישומי גישה.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.items.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.staffName}</span>
                <Badge>{e.subjectLabel}</Badge>
                {e.permission && (
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {e.permission}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                בנתוני: <span className="text-foreground">{e.ownerName}</span>
              </p>
              {e.reason && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  סיבה: {e.reason}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {formatDateTime(e.accessedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/access-log"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
