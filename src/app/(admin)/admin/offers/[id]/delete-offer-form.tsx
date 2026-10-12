'use client';

import { useActionState } from 'react';

import { FormError } from '@/components/forms';
import { deleteOfferAction } from '../actions';

// Confirm-gated delete (the packages precedent). The action is pre-bound with the id; on success
// it redirects to the list. An offer that ever produced an assignment is protected by the
// RESTRICT FK — the server answers with the deactivate-instead message, surfaced via FormError.
export function DeleteOfferForm({ id, title }: { id: string; title: string }) {
  const action = deleteOfferAction.bind(null, id);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`למחוק את ההצעה "${title}"? פעולה זו אינה הפיכה.`)) {
          e.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <FormError message={state?.error} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'מוחק…' : 'מחיקת ההצעה'}
      </button>
    </form>
  );
}
