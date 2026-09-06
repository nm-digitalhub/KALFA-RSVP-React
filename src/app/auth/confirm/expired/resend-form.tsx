'use client';

import { useActionState } from 'react';

import { resendConfirmationEmail } from '../../actions';
import { FieldError, FormNotice, SubmitButton } from '@/components/forms';

// Reached from a dead confirmation link, so the address is NOT known here — the
// token carried it and the token is gone. Asking for it again is the price of
// not leaking: this page is reachable by anyone with a malformed link, so the
// action answers with the same notice whether or not the address is registered.
export function ResendConfirmationForm() {
  const [state, action] = useActionState(resendConfirmationEmail, null);

  if (state?.notice) return <FormNotice message={state.notice} />;

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
        <FieldError errors={state?.fieldErrors?.email} />
      </div>
      <SubmitButton>שליחת קישור חדש</SubmitButton>
    </form>
  );
}
