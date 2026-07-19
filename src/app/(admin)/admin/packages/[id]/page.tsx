import { requirePlatformPermission } from '@/lib/auth/dal';
import Link from 'next/link';

import { getPackage } from '@/lib/data/admin/packages';
import { holdBufferFractionToPercent } from '@/lib/validation/admin';
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
  // Optimistic gate: redirect early instead of rendering an empty page. The
  // real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const { id } = await params;
  const pkg = await getPackage(id);

  // `includes` is stored as Json; the column holds a string[] by contract. Coerce
  // defensively for display (non-string entries are dropped).
  const includes = Array.isArray(pkg.includes)
    ? pkg.includes.filter((x): x is string => typeof x === 'string')
    : [];

  // outreach_schedule is stored as Json; the column holds an array of
  // touchpoint objects by contract (locked to what packages.ts writes).
  const outreachSchedule = Array.isArray(pkg.outreach_schedule)
    ? (pkg.outreach_schedule as unknown as {
        days_before: number;
        channel: 'whatsapp' | 'call';
        message_key: string;
      }[])
    : [];

  const initial: PackageFormInitial = {
    name: pkg.name,
    tier: pkg.tier,
    category: pkg.category,
    description: pkg.description ?? '',
    price_with_vat: pkg.price_with_vat,
    includes,
    active: pkg.active,
    sort_order: pkg.sort_order ?? 0,
    price_per_reached: pkg.price_per_reached ?? '',
    channels: pkg.channels ?? [],
    outreach_schedule: outreachSchedule,
    min_hold_floor: pkg.min_hold_floor,
    // Stored as a fraction (0.1); the form displays/accepts a percent (10).
    hold_buffer_pct_percent: holdBufferFractionToPercent(pkg.hold_buffer_pct),
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
