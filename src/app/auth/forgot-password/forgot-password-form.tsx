'use client';

import { useActionState } from 'react';

import { requestPasswordReset } from '../actions';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { actionFormError } from '@/lib/action-result';

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, {});

  return (
    <form action={action} className="space-y-4">
      <FormError message={actionFormError(state)} />
      <FormNotice message={state.data?.notice} />

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          אימייל
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

      <SubmitButton>שליחת קישור איפוס</SubmitButton>
    </form>
  );
}
