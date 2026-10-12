'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import { voidAssignmentAction } from './actions';

// The per-row void (task 7.3). The server is the judge — a held assignment answers with its own
// refusal message; the button is not rendered at all when the list already knows the row is held
// (the page passes heldReason), so the common case never offers a dead action.
export function VoidAssignmentForm({ id, heldReason }: { id: string; heldReason: string | null }) {
  const action = voidAssignmentAction.bind(null, id);
  const [state, formAction, pending] = useActionState(action, null);

  if (heldReason) {
    return <p className="text-xs text-muted-foreground">{heldReason}</p>;
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('לבטל את ההטבה? הלקוח לא יוכל להשתמש בה יותר.')) {
          e.preventDefault();
        }
      }}
      className="space-y-1"
    >
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <button
        type="submit"
        disabled={pending}
        className="h-7 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-destructive transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'מבטל…' : 'ביטול'}
      </button>
    </form>
  );
}
