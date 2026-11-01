'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import { refreshVoicePlatformAction, runLogExportAction } from '../actions';

// Small client wrappers for the two read-only/internal platform actions.

export function RefreshButton() {
  const [state, action, pending] = useActionState(refreshVoicePlatformAction, {});
  return (
    <form action={action} className="inline">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'רגע…' : 'רענן'}
      </button>
      <FormNotice message={state.data?.notice} />
      <FormError message={state.serverError} />
    </form>
  );
}

export function RunLogExportButton() {
  const [state, action, pending] = useActionState(runLogExportAction, {});
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
      >
        {pending ? 'מריץ…' : 'הרץ ייצוא עכשיו'}
      </button>
      <FormNotice message={state.data?.notice} />
      <FormError message={state.serverError} />
    </form>
  );
}
