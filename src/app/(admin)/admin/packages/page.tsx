import Link from 'next/link';

import { listPackages } from '@/lib/data/admin/packages';
import { PageHeading, EmptyState, Badge, formatCurrency } from '../_components';

// Admin: package catalogue management. Lists all packages (active + inactive)
// with a link to create a new one and to edit each existing package. The
// catalogue is small, so this view is not paginated.

export default async function AdminPackagesPage() {
  const packages = await listPackages();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeading>חבילות</PageHeading>
        <Link
          href="/admin/packages/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          חבילה חדשה
        </Link>
      </div>

      {packages.length === 0 ? (
        <EmptyState>אין חבילות עדיין. צרו את החבילה הראשונה.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {packages.map((pkg) => (
            <li key={pkg.id} className="px-4 py-3">
              <Link
                href={`/admin/packages/${pkg.id}`}
                className="flex items-center justify-between gap-4 transition-colors hover:text-primary"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{pkg.name}</p>
                    <Badge>{pkg.tier}</Badge>
                    {!pkg.active && <Badge>לא פעילה</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{pkg.category}</p>
                </div>
                <span className="font-medium">
                  {formatCurrency(pkg.price_with_vat)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
