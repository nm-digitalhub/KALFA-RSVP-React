'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

type BoundAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold transition hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {pending ? 'מעדכן…' : 'השלמת הכמות'}
    </button>
  );
}

/**
 * Offered on the guest list only while guests without an invited size exist —
 * the follow-up to an import whose source had no count column.
 *
 * It is worth prompting for rather than leaving blank: with no invited size the
 * public RSVP form falls back to a cap of 50, so a couple invited as two can
 * confirm fifty; "מעל הכמות שהוזמנה" cannot be flagged at all; and the headcount
 * counts the guest as one until they answer.
 *
 * Only the empty ones are touched — a guest whose count is already set, 0
 * included, is left exactly as it is.
 */
export function FillExpectedCount({
  missing,
  action,
}: {
  missing: number;
  action: BoundAction;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <section
      aria-labelledby="fill-count-title"
      className="rounded-xl border border-border bg-card p-4"
    >
      <h2 id="fill-count-title" className="text-sm font-bold">
        {missing.toLocaleString('he-IL')} מוזמנים ללא כמות מוזמנים
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        בלי כמות, המוזמן יכול לאשר הגעה לכל מספר ולא נוכל לסמן חריגה מהכמות
        שהוזמנה. אפשר להשלים כאן כמות אחידה לכולם, ולתקן פרטנית בהמשך.
      </p>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1.5 block text-muted-foreground">כמות לכל מוזמן</span>
          <input
            id="expected_count"
            name="expected_count"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            required
            defaultValue={2}
            className="w-28 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <SubmitButton />
      </form>

      <div className="mt-2 space-y-2">
        <FieldError errors={state?.fieldErrors?.expected_count} />
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </div>
    </section>
  );
}
