'use client';

import { useActionState } from 'react';

import { CALLBACK_STATUSES } from '@/lib/validation/admin';
import { CALLBACK_STATUS_LABELS } from '@/lib/data/admin/labels';
import { FieldError, FormError, FormNotice } from '@/components/forms';
import { updateCallbackStatusAction } from './actions';

// Per-row status control. A native <select> + submit keeps the surface small
// and avoids portal/RTL pitfalls of a custom popover; the form posts to a
// Server Action that validates the closed status vocabulary server-side.
//
// `currentStatus` may be a value outside CALLBACK_STATUSES (legacy/foreign
// free-text). In that case we prepend it as a disabled-looking extra option so
// the select reflects reality without losing the value, while still offering
// the canonical statuses to set.
export function CallbackStatusForm({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateCallbackStatusAction,
    null,
  );

  const isKnown = (CALLBACK_STATUSES as readonly string[]).includes(currentStatus);
  const selectId = `status-${id}`;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          סטטוס בקשת חזרה
        </label>
        <select
          id={selectId}
          name="status"
          defaultValue={currentStatus}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {!isKnown && (
            <option value={currentStatus}>{currentStatus}</option>
          )}
          {CALLBACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CALLBACK_STATUS_LABELS[s]}
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
      <FieldError errors={state?.fieldErrors?.status} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
