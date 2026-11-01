'use client';

import { useActionState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import { actionErrorMessage } from '@/lib/action-result';

import { createWorkflowAction } from './actions';

/**
 * The "new workflow" form.
 *
 * A client component only so the action's result can be read: a created
 * workflow navigates to its editor, and a failure (e.g. the data layer's "שם
 * התהליך לא יכול להיות ריק") is shown under the form. Before the move to
 * next-safe-action it replaced the page with the admin error boundary.
 */
export function CreateWorkflowForm() {
  const [state, formAction] = useActionState(createWorkflowAction, {});

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">שם התהליך החדש</span>
          <input
            name="name"
            required
            maxLength={120}
            className="min-h-11 w-72 rounded-md border border-input bg-background px-3"
            placeholder="למשל: אישור אוטומטי מוואטסאפ"
          />
        </label>
        {/* SubmitButton, not a bare Button. It carries useFormStatus and disables
            itself for the round-trip; a plain button stays clickable while the
            action runs, and every further click is another INSERT. MEASURED: 15
            empty workflows created in 17 seconds on 2026-09-10 that way. */}
        <SubmitButton className="w-auto">יצירה</SubmitButton>
      </form>
      <FormError message={actionErrorMessage(state)} />
    </div>
  );
}
