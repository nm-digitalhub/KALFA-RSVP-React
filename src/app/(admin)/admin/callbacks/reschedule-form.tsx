'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import { rescheduleCallbackAction } from './actions';

// <input type="datetime-local"> speaks local wall time, not ISO instants —
// same convention as event-edit-dialog.tsx's toLocalInput/fromLocalInput.
function nowPlusOneHourLocal(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The caller answered and either asked for a different time than they
// originally requested, or asked to be called again later ("let me think
// about it"). Both close the current calendar slot and open a new one from
// the instant chosen here — see rescheduleCallbackRequest for why the two
// are the same mechanical action.
export function RescheduleForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(
    rescheduleCallbackAction,
    null,
  );
  const fieldId = `reschedule-${id}`;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={fieldId} className="sr-only">
          מועד חדש לשיחה
        </label>
        <input
          id={fieldId}
          name="exactAt"
          type="datetime-local"
          defaultValue={nowPlusOneHourLocal()}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
        >
          {pending ? 'מתזמן…' : 'תזמנו שיחה למועד הזה'}
        </button>
      </div>
      <FieldError errors={state?.fieldErrors?.exactAt} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
