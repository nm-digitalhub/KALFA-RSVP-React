'use client';

import { useActionState } from 'react';

import { CALL_OUTCOMES } from '@/lib/validation/admin';
import { CALL_OUTCOME_LABELS } from '@/lib/data/admin/labels';
import { FieldError, FormError, FormNotice } from '@/components/forms';
import { updateCallOutcomeAction } from './actions';

// Records what happened when the owner actually made the call — a dimension
// fully separate from the request's scheduling status (see
// validation/admin.ts). Same native <select> + submit pattern as the old
// single-status form: small surface, no portal/RTL pitfalls.
export function CallOutcomeForm({
  id,
  currentOutcome,
}: {
  id: string;
  currentOutcome: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateCallOutcomeAction,
    null,
  );

  const isKnown = (CALL_OUTCOMES as readonly string[]).includes(currentOutcome);
  const selectId = `call-outcome-${id}`;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          תוצאת שיחה
        </label>
        <select
          id={selectId}
          name="callOutcome"
          defaultValue={currentOutcome}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {!isKnown && <option value={currentOutcome}>{currentOutcome}</option>}
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {CALL_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'שומר…' : 'עדכון'}
        </button>
      </div>
      <FieldError errors={state?.fieldErrors?.callOutcome} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
