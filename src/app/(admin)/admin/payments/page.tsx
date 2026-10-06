import type { Metadata } from 'next';

import { listPaymentReviews } from '@/lib/data/admin/payment-review';

import { EmptyState, PageHeading, formatCurrency, formatDateTime } from '../_components';
import { ReviewCard } from './review-card';

export const metadata: Metadata = { title: 'תשלומים לבדיקה' };

// Payment operations nobody can classify: the process died mid-call, or the provider's answer was unclear. They are
// never retried (a retry could charge twice) and they keep the "pay once" lock closed — so each one waits here until a
// person has checked the provider and decided. The data layer (listPaymentReviews) enforces `manage_billing`.
export default async function AdminPaymentsPage() {
  const items = await listPaymentReviews();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageHeading>תשלומים לבדיקה</PageHeading>
        <p className="max-w-2xl text-muted-foreground">
          פעולות תשלום שלא ידוע אם בוצעו. הן לא יחויבו שוב אוטומטית, והלקוח לא יכול לשלם מחדש עד שמכריעים בהן. יש
          לבדוק במסך של SUMIT אם החיוב בוצע, ואז לאשר או לסמן ככושלת.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState>אין פעולות תשלום שממתינות להכרעה.</EmptyState>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ReviewCard
              key={item.operationId}
              item={{
                operationId: item.operationId,
                kindLabel: item.kindLabel,
                amount: item.amount,
                amountLabel: formatCurrency(item.amount),
                recordedAtLabel: formatDateTime(item.recordedAt),
                eventName: item.eventName,
                eventHref: `/admin/events/${item.eventId}`,
                campaignHref: `/app/events/${item.eventId}/campaign/${item.campaignId}`,
                note: item.note,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
