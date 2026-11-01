'use client';

import { useActionState } from 'react';

import { resendConfirmationEmail } from '../../actions';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { actionFormError } from '@/lib/action-result';

// Reached from a dead confirmation link, so the address is NOT known here — the
// token carried it and the token is gone. Asking for it again is the price of
// not leaking: this page is reachable by anyone with a malformed link, so the
// action answers with the same notice whether or not the address is registered.
export function ResendConfirmationForm() {
  const [state, action] = useActionState(resendConfirmationEmail, {});

  if (state.data?.notice) return <FormNotice message={state.data.notice} />;

  return (
    <form action={action} className="space-y-3 text-start">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          כתובת המייל שאיתה נרשמתם
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-md border border-border bg-transparent px-3 py-2"
        />
        <FieldError errors={state.validationErrors?.fieldErrors?.email} />
      </div>
      {/* A failed send; the address's own message shows under its field. */}
      <FormError message={actionFormError(state)} />
      <SubmitButton>שליחת קישור חדש</SubmitButton>
    </form>
  );
}
