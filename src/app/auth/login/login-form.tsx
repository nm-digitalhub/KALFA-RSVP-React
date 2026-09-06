'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { login, resendConfirmationEmail } from '../actions';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { PasswordInput } from '@/components/password-input';

// Shown only after login reported `email_not_confirmed`, i.e. the password was
// already correct — so the address is carried over from that attempt rather than
// asked for again (React clears the inputs once a form action settles). Its own
// <form>, because a form cannot nest inside another one.
function ResendConfirmation({ email }: { email: string }) {
  const [state, action] = useActionState(resendConfirmationEmail, null);

  if (state?.notice) return <FormNotice message={state.notice} />;

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="email" value={email} />
      <SubmitButton className="w-auto" size="sm">
        שליחת מייל האישור מחדש
      </SubmitButton>
    </form>
  );
}

export function LoginForm() {
  const [state, action] = useActionState(login, null);

  return (
    <>
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
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
          />
          <FieldError errors={state?.fieldErrors?.password} />
          <div className="mt-1 text-end">
            <Link
              href="/auth/forgot-password"
              className="text-sm font-medium text-primary hover:underline"
            >
              שכחתם סיסמה?
            </Link>
          </div>
        </div>

        <SubmitButton>התחברות</SubmitButton>
      </form>

      {state?.unconfirmedEmail ? (
        <ResendConfirmation email={state.unconfirmedEmail} />
      ) : null}
    </>
  );
}
