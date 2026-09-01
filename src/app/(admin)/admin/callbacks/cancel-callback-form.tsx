'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import { isCancellableCallbackStatus } from '@/lib/validation/admin';
import { cancelCallbackAction } from './actions';

// The ONE scheduling-status transition an admin makes directly — every other
// `status` value is system-driven (see validation/admin.ts).
//
// Hidden on a terminal request, using the SAME predicate the server refuses
// with (isCancellableCallbackStatus) rather than a second copy of the rule
// that can drift from it. This is presentation, not protection: cancelCallback
// refuses on its own, and the filter is repeated inside its UPDATE.
export function CancelCallbackForm({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(
    cancelCallbackAction,
    null,
  );

  if (!isCancellableCallbackStatus(currentStatus)) return null;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-destructive/30 px-3 py-1 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
      >
        {pending ? 'מבטל…' : 'בטל בקשה'}
      </button>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
