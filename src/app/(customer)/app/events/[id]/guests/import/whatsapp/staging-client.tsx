'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

type BoundAction = (prev: FormState, formData: FormData) => Promise<FormState>;

function SubmitButton({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        danger
          ? 'rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60'
          : 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60'
      }
    >
      {pending ? 'רגע…' : label}
    </button>
  );
}

export function StagingActions({
  confirm,
  discard,
}: {
  confirm: BoundAction;
  discard: BoundAction;
}) {
  const [confirmState, confirmAction] = useActionState(confirm, null);
  const [discardState, discardAction] = useActionState(discard, null);
  const state = confirmState ?? discardState;

  return (
    <div className="space-y-2">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <div className="flex gap-2">
        <form action={confirmAction}>
          <SubmitButton label="אישור ייבוא" />
        </form>
        <form action={discardAction}>
          <SubmitButton label="מחיקה" danger />
        </form>
      </div>
    </div>
  );
}
