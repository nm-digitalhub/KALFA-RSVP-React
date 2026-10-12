import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformPermission } from '@/lib/auth/dal';

import { listOfferPackageChoices } from '@/lib/data/admin/offers';
import { PageHeading } from '../../_components';
import { OfferForm } from '../offer-form';
import { createOfferAction } from '../actions';

export const metadata: Metadata = { title: 'הצעה חדשה' };

// Admin: create a new offer (personal-coupons D14). The form posts to createOfferAction, which
// validates server-side (including the positive-floor refusal) and redirects back to the list.
export default async function NewOfferPage() {
  // Optimistic gate: redirect early instead of rendering an empty page. The real enforcement is
  // per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const packageChoices = await listOfferPackageChoices();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <PageHeading>הצעה חדשה</PageHeading>
        <Link href="/admin/offers" className="text-sm text-muted-foreground hover:text-foreground">
          חזרה לרשימת ההצעות
        </Link>
      </div>

      <OfferForm
        action={createOfferAction}
        submitLabel="יצירת הצעה"
        packageChoices={packageChoices}
      />
    </div>
  );
}
