import { listAllOrders } from '@/lib/data/admin/orders';
import { ORDER_STATUS_LABELS } from '@/lib/data/admin/labels';
import {
  PageHeading,
  EmptyState,
  Pagination,
  Badge,
  formatCurrency,
  formatDateTime,
  parsePageParam,
} from '../_components';
import { ReconcileButton } from './reconcile-button';

// Admin: ALL orders (read-only), paginated server-side. The package name/tier
// and event name are embedded via FK so each row is readable without per-row
// lookups. The only mutation surfaced here is reconciliation (a separate gated
// endpoint) for orders the payment flow could not resolve on its own. The
// "stuck processing" flag is derived server-side in listAllOrders so the clock
// is never read during render.

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePageParam((await searchParams).page);
  const result = await listAllOrders({ page });

  return (
    <div className="space-y-6">
      <PageHeading>הזמנות</PageHeading>

      {result.items.length === 0 ? (
        <EmptyState>אין הזמנות עדיין.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.items.map((order) => (
            <li
              key={order.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {order.package?.name ?? 'חבילה לא ידועה'}
                  </p>
                  <Badge>{ORDER_STATUS_LABELS[order.status]}</Badge>
                  {order.isStuckProcessing && <Badge>תקוע</Badge>}
                  {order.with_ai_addon && <Badge>תוספת AI</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {[order.event?.name, order.package?.tier]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(order.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {order.status === 'payment_review' && (
                  <ReconcileButton orderId={order.id} action="auto" />
                )}
                {order.isStuckProcessing && (
                  <ReconcileButton orderId={order.id} action="reset" />
                )}
                <span className="font-medium">
                  {formatCurrency(order.total_with_vat)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/orders"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
