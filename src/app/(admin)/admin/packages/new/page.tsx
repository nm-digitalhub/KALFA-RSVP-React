import Link from 'next/link';

import { PageHeading } from '../../_components';
import { PackageForm } from '../package-form';
import { createPackageAction } from '../actions';

// Admin: create a new package. The form posts to createPackageAction, which
// validates server-side and redirects back to the list on success.
export default function NewPackagePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <PageHeading>חבילה חדשה</PageHeading>
        <Link
          href="/admin/packages"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          חזרה לרשימת החבילות
        </Link>
      </div>

      <PackageForm action={createPackageAction} submitLabel="יצירת חבילה" />
    </div>
  );
}
