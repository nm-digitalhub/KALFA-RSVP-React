'use client';

import { useActionState, useState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import type { AssignableOffer } from '@/lib/data/admin/coupon-assignments';
import { createAssignmentAction } from '../actions';

// The assign form (task 7.3, mockup ui/AssignNew.dc.html). Everything money-shaped arrives
// PRECOMPUTED from the server page (the same computeOfferOption the assignment freezes), so the
// preview the staff member reads is exactly what createStaffAssignment will store. The browser
// submits only the email, the offer id and the page's idempotency uuid — never a price.

export function AssignForm({
  offers,
  idempotencyKey,
}: {
  offers: AssignableOffer[];
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(createAssignmentAction, null);
  const [selectedId, setSelectedId] = useState(offers[0]?.id ?? '');
  const selected = offers.find((o) => o.id === selectedId) ?? null;

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary';

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError message={state?.error} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />

      <div className="space-y-1">
        <label htmlFor="assign-email" className="block text-sm font-medium">
          חשבון הלקוח
        </label>
        <input
          id="assign-email"
          name="email"
          type="email"
          required
          dir="ltr"
          placeholder="חיפוש לפי אימייל"
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground">
          ההטבה ניתנת לחשבון עצמו, בלי צורך באימות טלפון.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="assign-offer" className="block text-sm font-medium">
          הצעה
        </label>
        <select
          id="assign-offer"
          name="offer_id"
          required
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={inputClass}
        >
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title} · {o.valueLabel}
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-semibold">הלקוח יקבל</p>
          <ul className="list-disc ps-5 text-sm leading-relaxed">
            {selected.options.map((opt) => (
              <li key={`${selected.id}-${opt.name}`}>
                {opt.name}: <span dir="ltr">{opt.finalPrice}</span> במקום{' '}
                <span dir="ltr" className="line-through">
                  {opt.listPrice}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            בתוקף עד {selected.expiresLabel}. המחירים נשמרים בהטבה, ושינוי מחיר או הצעה בהמשך לא
            ישנה אותה.
          </p>
        </div>
      ) : null}

      <SubmitButton disabled={pending} className="h-10 w-full rounded-lg">
        {pending ? 'מקצה…' : 'הקצאה'}
      </SubmitButton>
    </form>
  );
}
