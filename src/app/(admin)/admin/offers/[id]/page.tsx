import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformPermission } from '@/lib/auth/dal';

import { getOffer, listOfferPackageChoices } from '@/lib/data/admin/offers';
import { PageHeading } from '../../_components';
import { OfferForm, type OfferFormInitial } from '../offer-form';
import { updateOfferAction } from '../actions';
import { DeleteOfferForm } from './delete-offer-form';

export const metadata: Metadata = { title: 'עריכת הצעה' };

// Admin: edit an existing offer. getOffer() calls notFound() for a missing id (404). The update
// action is pre-bound with the id and passed to the shared OfferForm; deletion is a separate
// confirm-gated form. Existing assignments are untouched by any edit (D3's freeze) — the form
// says so to the staff.

export default async function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  // Optimistic gate: redirect early instead of rendering an empty page. The real enforcement is
  // per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const { id } = await params;
  const [offer, packageChoices] = await Promise.all([getOffer(id), listOfferPackageChoices()]);

  const initial: OfferFormInitial = {
    title: offer.title,
    // `kind` is constrained by the DB check to percent/amount; narrow defensively for the form.
    kind: offer.kind === 'amount' ? 'amount' : 'percent',
    value: Number(offer.value),
    validity_days: offer.validity_days,
    allow_agent: offer.allow_agent,
    allow_staff: offer.allow_staff,
    agent_objections: offer.agent_objections,
    may_replace: offer.may_replace,
    is_active: offer.is_active,
    packages: offer.packages.map((p) => ({
      package_id: p.package_id,
      value_override: p.value_override == null ? null : Number(p.value_override),
    })),
  };

  // Bind the id so the client form receives the (prevState, formData) signature.
  const updateAction = updateOfferAction.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <PageHeading>עריכת הצעה</PageHeading>
        <Link href="/admin/offers" className="text-sm text-muted-foreground hover:text-foreground">
          חזרה לרשימת ההצעות
        </Link>
      </div>

      <OfferForm
        action={updateAction}
        initial={initial}
        submitLabel="שמירת שינויים"
        packageChoices={packageChoices}
      />

      <div className="border-t border-border pt-6">
        <DeleteOfferForm id={id} title={offer.title} />
      </div>
    </div>
  );
}
