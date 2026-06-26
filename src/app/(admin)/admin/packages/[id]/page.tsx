import Link from 'next/link';

import { getPackage } from '@/lib/data/admin/packages';
import { PageHeading } from '../../_components';
import { PackageForm, type PackageFormInitial } from '../package-form';
import { updatePackageAction } from '../actions';
import { DeletePackageForm } from './delete-package-form';

// Admin: edit an existing package. getPackage() calls notFound() for a missing
// id (404). The update action is pre-bound with the id and passed to the shared
// PackageForm; deletion is a separate confirm-gated form.

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pkg = await getPackage(id);

  // `includes` is stored as Json; the column holds a string[] by contract. Coerce
  // defensively for display (non-string entries are dropped).
  const includes = Array.isArray(pkg.includes)
    ? pkg.includes.filter((x): x is string => typeof x === 'string')
    : [];

  const initial: PackageFormInitial = {
    name: pkg.name,
    tier: pkg.tier,
    category: pkg.category,
    description: pkg.description ?? '',
    price_with_vat: pkg.price_with_vat,
    includes,
    active: pkg.active,
  };

  // Bind the id so the client form receives the (prevState, formData) signature.
  const updateAction = updatePackageAction.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <PageHeading>עריכת חבילה</PageHeading>
        <Link
          href="/admin/packages"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          חזרה לרשימת החבילות
        </Link>
      </div>

      <PackageForm
        action={updateAction}
        initial={initial}
        submitLabel="שמירת שינויים"
      />

      <div className="border-t border-border pt-6">
        <DeletePackageForm id={id} name={pkg.name} />
      </div>
    </div>
  );
}
