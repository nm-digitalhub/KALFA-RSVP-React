'use client';

import { useActionState } from 'react';
import { Can } from '@casl/react';

import { FormError } from '@/components/forms';
import type { PlatformAbility } from '@/lib/casl';
import { deletePackageAction } from '../actions';

// Confirm-gated delete. The action is pre-bound with the id; on success it
// redirects to the list (so no success state is rendered here). A native
// confirm() guards the destructive action. Errors surface via FormError.
// Rendered, divider included, only for a viewer who may `delete Package`; display
// only, deletePackageAction checks the same action itself
// (pilot-casl-package-permissions, design D5).
export function DeletePackageForm({ id, name }: { id: string; name: string }) {
  const action = deletePackageAction.bind(null, id);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <Can<PlatformAbility> I="delete" a="Package">
      <div className="border-t border-border pt-6">
        <form
          action={formAction}
          onSubmit={(e) => {
            if (!window.confirm(`למחוק את החבילה "${name}"? פעולה זו אינה הפיכה.`)) {
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
            {pending ? 'מוחק…' : 'מחיקת החבילה'}
          </button>
        </form>
      </div>
    </Can>
  );
}
