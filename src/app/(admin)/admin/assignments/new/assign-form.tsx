'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import type { AssignableOffer } from '@/lib/data/admin/coupon-assignments';
import { createAssignmentAction } from '../actions';

// The assign form (admin-panel ג.2/ג.3, spec §8). It renders only AFTER the account step
// resolved and confirmed a real account. The offer choice is EXPLICIT — no silent default —
// and the preview the staff member sees is echoed back as the confirmed terms, which the
// server re-validates (and refuses with "תנאי ההצעה השתנו" when the offer drifted). The
// browser still never sends a price of its own: the echo is compared, never trusted.

export function AssignForm({
  email,
  offers,
  idempotencyKey,
}: {
  email: string;
  offers: AssignableOffer[];
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(createAssignmentAction, null);
  const [selectedId, setSelectedId] = useState('');
  const selected = offers.find((o) => o.id === selectedId) ?? null;
  const selectRef = useRef<HTMLSelectElement>(null);

  // React resets a form's fields when its action settles. A refusal keeps the page, so the
  // select must go back to the choice the preview and the confirmed terms still show.
  useEffect(() => {
    if (selectRef.current && selectRef.current.value !== selectedId) {
      selectRef.current.value = selectedId;
    }
  }, [state, selectedId]);

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary';

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError message={state?.error} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input
        type="hidden"
        name="confirmed_terms"
        value={selected ? JSON.stringify(selected.rawOptions) : ''}
      />

      <div className="space-y-1">
        <label htmlFor="assign-offer" className="block text-sm font-medium">
          הצעה
        </label>
        <select
          id="assign-offer"
          ref={selectRef}
          name="offer_id"
          required
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            בחרו הצעה…
          </option>
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
            תוקף משוער עד {selected.expiresLabel} — המועד הסופי נקבע ברגע ההקצאה בפועל.
            המחירים נשמרים בהטבה, ושינוי מחיר או הצעה בהמשך לא ישנה אותה.
          </p>
        </div>
      ) : null}

      <SubmitButton disabled={pending || !selected} className="h-10 w-full rounded-lg">
        {pending ? 'מקצה…' : 'הקצאת הטבה'}
      </SubmitButton>
    </form>
  );
}
