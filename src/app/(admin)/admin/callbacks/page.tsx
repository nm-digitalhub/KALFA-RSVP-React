import { requirePlatformPermission } from '@/lib/auth/dal';
import { listCallbackRequests } from '@/lib/data/admin/callbacks';
import { callbackStatusLabel } from '@/lib/data/admin/labels';
import {
  PageHeading,
  EmptyState,
  Pagination,
  Badge,
  formatDateTime,
  parsePageParam,
} from '../_components';
import { CallbackStatusForm } from './callback-status-form';

// Admin: callback (call-me-back) requests, paginated server-side. Each row
// shows the request details, the current status (via free-text-safe label) and
// an inline form to change the status.

export default async function AdminCallbacksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  // Optimistic gate (Next.js term): redirects early so the operator does not
  // land on an empty page. The real enforcement is per-function in the DAL.
  await requirePlatformPermission('view_customer_data');
  const page = parsePageParam((await searchParams).page);
  const result = await listCallbackRequests({ page });

  return (
    <div className="space-y-6">
      <PageHeading>בקשות חזרה</PageHeading>

      {result.items.length === 0 ? (
        <EmptyState>אין בקשות חזרה עדיין.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.items.map((cb) => (
            <li
              key={cb.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{cb.full_name}</p>
                  <Badge>{callbackStatusLabel(cb.status)}</Badge>
                </div>
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {cb.phone}
                </p>
                {cb.topic && <p className="text-sm">{cb.topic}</p>}
                {cb.note && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {cb.note}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(cb.created_at)}
                </p>
              </div>
              <CallbackStatusForm id={cb.id} currentStatus={cb.status} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/callbacks"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
