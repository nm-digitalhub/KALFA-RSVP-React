import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformPermission } from '@/lib/auth/dal';

import { listOffers } from '@/lib/data/admin/offers';
import { PageHeading, EmptyState, Badge } from '../_components';

export const metadata: Metadata = { title: 'הצעות להטבה' };

// Admin: the staff-managed offers (personal-coupons D14, mockup ui/Offers.dc.html). Lists all
// offers (active + inactive) with a link to create a new one and to edit each. The set is small,
// so this view is not paginated.

// Who may assign, as the list shows it (mockup: "עומר וצוות" / "צוות בלבד").
function assignersLabel(offer: { allow_agent: boolean; allow_staff: boolean }): string {
  if (offer.allow_agent && offer.allow_staff) return 'עומר וצוות';
  if (offer.allow_agent) return 'עומר בלבד';
  if (offer.allow_staff) return 'צוות בלבד';
  return 'אף אחד';
}

function valueLabel(offer: { kind: string; value: number }): string {
  return offer.kind === 'percent' ? `${offer.value}%` : `₪${offer.value}`;
}

function packagesLabel(count: number): string {
  return count === 1 ? 'חבילה אחת' : `${count} חבילות`;
}

export default async function AdminOffersPage() {
  // Optimistic gate (Next.js term): redirects early so the operator does not land on an empty
  // page. The real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const offers = await listOffers();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeading>הצעות להטבה</PageHeading>
        <Link
          href="/admin/offers/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          הצעה חדשה
        </Link>
      </div>

      {offers.length === 0 ? (
        <EmptyState>אין הצעות עדיין. צרו את ההצעה הראשונה.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {offers.map((offer) => (
            <li key={offer.id} className="px-4 py-3">
              <Link
                href={`/admin/offers/${offer.id}`}
                className="flex items-center justify-between gap-4 transition-colors hover:text-primary"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{offer.title}</p>
                    <Badge>{assignersLabel(offer)}</Badge>
                    {!offer.is_active && <Badge>לא פעילה</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {packagesLabel(offer.packages.length)} · תוקף {offer.validity_days} ימים
                  </p>
                </div>
                <span className="font-medium" dir="ltr">
                  {valueLabel(offer)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
