import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { Receipt } from 'lucide-react';

import { listOrders, ORDER_STATUS_LABELS } from '@/lib/data/orders';
import type { OrderListItem } from '@/lib/data/orders';
import { getPaymentsEnabled } from '@/lib/data/payments';
import { formatCurrency } from '@/lib/format';

// Hebrew date formatter (he-IL).
const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium' });

const statusBadgeBaseClass =
  'shrink-0 rounded-full border px-3 py-1 text-xs';

// Neutral default; only 'processing' and 'payment_review' get distinct styling.
// Label text always comes from ORDER_STATUS_LABELS — only the className varies.
const statusBadgeOverrides: Partial<Record<OrderListItem['status'], string>> = {
  processing: 'border-blue-200 bg-blue-50 text-blue-700',
  payment_review: 'border-amber-200 bg-amber-50 text-amber-700',
};

const payButtonClass =
  'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90';

function OrderCard({
  order,
  paymentsEnabled,
}: {
  order: OrderListItem;
  paymentsEnabled: boolean;
}) {
  const badgeClass =
    statusBadgeOverrides[order.status] ?? 'border-border text-muted-foreground';
  const isPayable =
    paymentsEnabled &&
    (order.status === 'pending' || order.status === 'failed');

  return (
    <li className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-5">
      <div className="space-y-1">
        <p className="font-semibold">{formatCurrency(order.total_with_vat)}</p>
        <p className="text-sm text-muted-foreground">
          {dateFmt.format(new Date(order.created_at))}
        </p>
        {order.with_ai_addon ? (
          <p className="text-xs text-muted-foreground">כולל תוסף AI</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className={`${statusBadgeBaseClass} ${badgeClass}`}>
          {ORDER_STATUS_LABELS[order.status]}
        </span>
        {isPayable ? (
          <Link href={`/app/orders/${order.id}/pay`} className={payButtonClass}>
            שלם עכשיו
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string }>;
}) {
  const { paid } = await searchParams;

  // Fail-safe: false on any error, so the pay button hides if we can't confirm.
  const paymentsEnabled = await getPaymentsEnabled();

  let orders: OrderListItem[] = [];
  let loadError = false;

  try {
    orders = await listOrders();
  } catch (err) {
    // requireUser() inside listOrders enforces auth by THROWING a NEXT_REDIRECT
    // signal; it must propagate so the unauthenticated user reaches login.
    // Only a genuine load failure becomes the on-page error state.
    unstable_rethrow(err);
    loadError = true;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">הזמנות</h1>

      {paid === '1' ? (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          התשלום התקבל בהצלחה
        </p>
      ) : null}

      {loadError ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          טעינת ההזמנות נכשלה. נסו לרענן את העמוד.
        </p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <Receipt className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">אין הזמנות עדיין</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              paymentsEnabled={paymentsEnabled}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
