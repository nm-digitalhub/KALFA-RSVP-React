'use client';

import { useActionState } from 'react';

import { updatePassword } from '../actions';
import { FieldError, FormError, SubmitButton } from '@/components/forms';
import { actionFormError } from '@/lib/action-result';
import { PasswordInput } from '@/components/password-input';

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePassword, {});

  return (
    <form action={action} className="space-y-4">
      <FormError message={actionFormError(state)} />

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          סיסמה חדשה
        </label>
        <PasswordInput id="password" name="password" autoComplete="new-password" required />
        <FieldError errors={state.validationErrors?.fieldErrors?.password} />
      </div>

      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
          אימות סיסמה
        </label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
        <FieldError errors={state.validationErrors?.fieldErrors?.confirm} />
      </div>

      <SubmitButton>עדכון סיסמה</SubmitButton>
    </form>
  );
}
