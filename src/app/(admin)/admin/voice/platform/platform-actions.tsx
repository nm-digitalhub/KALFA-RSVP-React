'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import { refreshVoicePlatformAction, runLogExportAction } from '../actions';

// Small client wrappers for the two read-only/internal platform actions. The
// wiring (SetAccountInfo) action is added in the wiring stage.

export function RefreshButton() {
  const [state, action, pending] = useActionState<FormState>(refreshVoicePlatformAction, null);
  return (
    <form action={action} className="inline">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'רגע…' : 'רענן'}
      </button>
      <FormNotice message={state?.notice} />
      <FormError message={state?.error} />
    </form>
  );
}

export function RunLogExportButton() {
  const [state, action, pending] = useActionState<FormState>(runLogExportAction, null);
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'מריץ…' : 'הרץ ייצוא עכשיו'}
      </button>
      <FormNotice message={state?.notice} />
      <FormError message={state?.error} />
    </form>
  );
}
