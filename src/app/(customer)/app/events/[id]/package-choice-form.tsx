'use client';

import { useActionState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import { formatAmount } from '@/lib/format';
import type { FormState } from '@/lib/validation/result';

// What the owner needs to choose a fixed-price package. These are for READING: the form submits only `package_id`, and
// the server (createCampaign) reads the package's own price and quota when it creates the campaign.
export type PackageChoiceOffer = {
  id: string;
  name: string;
  price: number;
  contact_quota: number;
  description: string | null;
  includes: string[];
};

// The "בחירת חבילה" step of the setup flow. One radio per package on offer; with a single package it is pre-selected,
// with several the owner must choose. useActionState surfaces the server's safe Hebrew error inline; on success the
// action redirects back to the setup page, which then shows the agreement. Customer-facing wording that touches the
// price is reviewed for compliance before it goes live.
export function PackageChoiceForm({
  action,
  offers,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  offers: PackageChoiceOffer[];
}) {
  const [state, formAction] = useActionState(action, null);

  if (offers.length === 0) {
    return <p className="text-sm text-muted-foreground">אין כרגע חבילות זמינות. נסו שוב מאוחר יותר.</p>;
  }

  return (
    <form action={formAction} className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="sr-only">בחירת חבילה</legend>
        {offers.map((offer) => (
          <div key={offer.id} className="rounded-lg border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <div className="flex items-start gap-3">
              <input
                id={`package-${offer.id}`}
                type="radio"
                name="package_id"
                value={offer.id}
                defaultChecked={offers.length === 1}
                required
                className="mt-1 size-4"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor={`package-${offer.id}`} className="flex flex-wrap items-baseline justify-between gap-2 font-medium">
                  <span>{offer.name}</span>
                  <span dir="ltr">{formatAmount(offer.price)}</span>
                </label>
                <p className="text-sm text-muted-foreground">עד {offer.contact_quota} אנשי קשר</p>
                {offer.description ? <p className="text-sm whitespace-pre-line">{offer.description}</p> : null}
                {offer.includes.length > 0 ? (
                  <ul className="list-disc ps-5 text-sm text-muted-foreground">
                    {offer.includes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        אחרי הבחירה תקראו את ההסכם ותחתמו עליו. התשלום נעשה פעם אחת, בשלב הבא.
      </p>
      <FormError message={state?.error} />
      <SubmitButton>בחירה והמשך להסכם</SubmitButton>
    </form>
  );
}
