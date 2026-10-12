import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import Link from 'next/link';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { listAssignableOffers } from '@/lib/data/admin/coupon-assignments';
import { formatIsraelDate } from '@/lib/date';
import { PageHeading, formatCurrency } from '../../_components';
import { AssignForm } from './assign-form';

export const metadata: Metadata = { title: 'הקצאת הטבה' };

// Staff assign (task 7.3, mockup ui/AssignNew.dc.html). The offer previews come precomputed from
// the data layer (the SAME computeOfferOption createStaffAssignment freezes), so what the staff
// member reads is what the customer gets; the browser later submits only email + offer id.
export default async function AdminAssignNewPage() {
  // Optimistic gate; the real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');

  const offers = await listAssignableOffers({ currency: formatCurrency, date: formatIsraelDate });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <PageHeading>הקצאת הטבה</PageHeading>
        <Link href="/admin/assignments" className="text-sm text-muted-foreground hover:underline">
          <span aria-hidden="true">→</span> חזרה להטבות אישיות
        </Link>
      </div>

      {offers.length === 0 ? (
        <p className="max-w-xl rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          אין הצעה פעילה שמותרת להקצאת צוות.{' '}
          <Link href="/admin/offers" className="text-primary hover:underline">
            הגדרת הצעות
          </Link>
        </p>
      ) : (
        <AssignForm offers={offers} idempotencyKey={randomUUID()} />
      )}
    </div>
  );
}
