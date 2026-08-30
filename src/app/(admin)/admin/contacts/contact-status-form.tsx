'use client';

import { useActionState } from 'react';

import { CONTACT_STATUSES } from '@/lib/validation/admin';
import { CONTACT_STATUS_LABELS, contactStatusLabel } from '@/lib/data/admin/labels';
import { FieldError, FormError, FormNotice } from '@/components/forms';
import { updateContactStatusAction } from './actions';

// Per-row status control for contact messages — same closed vocabulary and
// same native-select pattern as the callbacks page (no portal/RTL pitfalls).
export function ContactStatusForm({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateContactStatusAction,
    null,
  );

  const isKnown = (CONTACT_STATUSES as readonly string[]).includes(currentStatus);
  const selectId = `contact-status-${id}`;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          סטטוס פנייה
        </label>
        <select
          id={selectId}
          name="status"
          defaultValue={currentStatus}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {!isKnown && (
            <option value={currentStatus}>{contactStatusLabel(currentStatus)}</option>
          )}
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTACT_STATUS_LABELS[s]}
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
