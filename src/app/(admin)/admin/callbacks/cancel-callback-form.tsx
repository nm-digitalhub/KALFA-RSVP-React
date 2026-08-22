'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import { cancelCallbackAction } from './actions';

// The ONE scheduling-status transition an admin makes directly — every other
// `status` value is system-driven (see validation/admin.ts). Hidden once the
// request is already cancelled: there is nothing left to cancel, and a live
// button there would just invite a confusing no-op resubmission.
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

  if (currentStatus === 'cancelled') return null;

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
