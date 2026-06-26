'use client';

import { useActionState } from 'react';

import { login } from '../actions';
import { FieldError, FormError, SubmitButton } from '@/components/forms';

export function LoginForm() {
  const [state, action] = useActionState(login, null);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />

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
        <FieldError errors={state?.fieldErrors?.email} />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          סיסמה
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-border bg-transparent px-3 py-2"
        />
        <FieldError errors={state?.fieldErrors?.password} />
      </div>

      <SubmitButton>התחברות</SubmitButton>
    </form>
  );
}
