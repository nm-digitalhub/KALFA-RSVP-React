'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { FormError, SubmitButton } from '@/components/forms';
import { formatAmount } from '@/lib/format';
import type { FormState } from '@/lib/validation/result';

// What the owner needs to choose a fixed-price package. These are for READING: the form submits only `package_id`, and
// the server (createCampaign / changeCampaignPackage) reads the package's own price and quota. The benefit block is
// read-only too: every price in it was computed and FROZEN on the server (personal-coupons D3/D14) — nothing here is
// ever sent back.
export type PackageChoiceOffer = {
  id: string;
  name: string;
  price: number;
  contact_quota: number;
  description: string | null;
  includes: string[];
};

/** The personal-benefit display state (tasks 7.1/7.2, mocked in ui/Main.dc.html + ui/States.dc.html). */
export type PackageChoiceBenefit =
  | { kind: 'none' }
  | { kind: 'verify_invite' }
  | {
      kind: 'active';
      /** Pre-formatted Israel date — the server formats, the client only renders. */
      expiresAtLabel: string;
      /** packageId → the frozen prices; a package absent here sells at its list price. */
      perPackage: Record<string, { listPrice: number; finalPrice: number }>;
    }
  | { kind: 'used'; eventName: string | null }
  | { kind: 'ended'; reason: 'expired' | 'unavailable'; endedAtLabel: string | null };

// The "בחירת חבילה" step of the setup flow. One radio per package on offer; with a single package it is pre-selected,
// with several the owner must choose. When a campaign already exists (pending approval), the current package arrives
// pre-selected and submitting a different one MOVES the campaign — and its benefit — to it (task 5.3). useActionState
// surfaces the server's safe Hebrew error inline. Customer-facing wording that touches the price is reviewed for
// compliance before it goes live.
export function PackageChoiceForm({
  action,
  offers,
  benefit = { kind: 'none' },
  selectedPackageId = null,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  offers: PackageChoiceOffer[];
  benefit?: PackageChoiceBenefit;
  selectedPackageId?: string | null;
}) {
  const [state, formAction] = useActionState(action, null);

  if (offers.length === 0) {
    return <p className="text-sm text-muted-foreground">אין כרגע חבילות זמינות. נסו שוב מאוחר יותר.</p>;
  }

  const benefitFor = (packageId: string) =>
    benefit.kind === 'active' ? (benefit.perPackage[packageId] ?? null) : null;

  return (
    <form action={formAction} className="space-y-4">
      {benefit.kind === 'verify_invite' ? (
        // Task 7.2: the NEUTRAL invitation — identical whether or not any offer exists.
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/50 p-3 text-sm">
          <span>דיברתם עם נציג של KALFA? אמתו את מספר הטלפון, ואם נשמרה עבורכם הצעה בשיחה היא תופיע כאן.</span>
          <Link
            href="/app/settings"
            className="inline-flex h-7 items-center whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-xs font-medium"
          >
            אימות מספר הטלפון
          </Link>
        </div>
      ) : null}

      {benefit.kind === 'active' ? (
        <div role="status" className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm leading-relaxed">
          <strong className="font-semibold">יש לכם הטבה אישית</strong> על החבילות המסומנות, לרכישה אחת. ההטבה בתוקף עד{' '}
          {benefit.expiresAtLabel}.
        </div>
      ) : null}

      {benefit.kind === 'ended' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {benefit.reason === 'expired' && benefit.endedAtLabel
            ? `ההטבה האישית שלכם הסתיימה ב-${benefit.endedAtLabel}. המחירים המוצגים הם המחירים הרגילים.`
            : 'ההטבה האישית שלכם אינה זמינה עוד. לשאלות אפשר לפנות אלינו.'}
        </p>
      ) : null}

      {benefit.kind === 'used' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {benefit.eventName
            ? `ההטבה האישית שלכם כבר משמשת לאירוע "${benefit.eventName}". היא תקפה לרכישה אחת.`
            : 'ההטבה האישית שלכם כבר מומשה. היא תקפה לרכישה אחת.'}
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="sr-only">בחירת חבילה</legend>
        {offers.map((offer) => {
          const prices = benefitFor(offer.id);
          return (
            <div key={offer.id} className="rounded-lg border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <div className="flex items-start gap-3">
                <input
                  id={`package-${offer.id}`}
                  type="radio"
                  name="package_id"
                  value={offer.id}
                  defaultChecked={selectedPackageId ? offer.id === selectedPackageId : offers.length === 1}
                  required
                  className="mt-1 size-4"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <label htmlFor={`package-${offer.id}`} className="flex flex-wrap items-baseline justify-between gap-2 font-medium">
                    <span>{offer.name}</span>
                    {prices ? (
                      <span className="flex items-baseline gap-2">
                        <span dir="ltr" aria-hidden className="text-sm font-normal text-muted-foreground line-through">
                          {formatAmount(prices.listPrice)}
                        </span>
                        <span dir="ltr" aria-hidden>
                          {formatAmount(prices.finalPrice)}
                        </span>
                        <span className="sr-only">
                          {`מחיר עם ההטבה ${formatAmount(prices.finalPrice)} במקום ${formatAmount(prices.listPrice)}`}
                        </span>
                      </span>
                    ) : (
                      <span dir="ltr">{formatAmount(offer.price)}</span>
                    )}
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
          );
        })}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        אחרי הבחירה תקראו את ההסכם ותחתמו עליו. התשלום נעשה פעם אחת, בשלב הבא.
      </p>
      <FormError message={state?.error} />
      <SubmitButton>{selectedPackageId ? 'עדכון הבחירה והמשך' : 'בחירה והמשך להסכם'}</SubmitButton>
    </form>
  );
}
