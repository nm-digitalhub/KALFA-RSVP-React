'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { login, resendConfirmationEmail } from '../actions';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { PasswordInput } from '@/components/password-input';
import { actionErrorMessage, actionFormError } from '@/lib/action-result';

// Shown only after login reported `email_not_confirmed`, i.e. the password was
// already correct — so the address is carried over from that attempt rather than
// asked for again (React clears the inputs once a form action settles). Its own
// <form>, because a form cannot nest inside another one.
function ResendConfirmation({ email }: { email: string }) {
  const [state, action] = useActionState(resendConfirmationEmail, {});

  return (
    <>
      {state.data?.notice ? (
        <FormNotice message={state.data.notice} />
      ) : (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="email" value={email} />
          {/* A failed send. The address is a hidden field, so its message can show only here. */}
          <FormError message={actionErrorMessage(state)} />
          <SubmitButton className="w-auto" size="sm">
            שליחת מייל האישור מחדש
          </SubmitButton>
        </form>
      )}

      {/* Supabase exposes no way to change an unconfirmed account's address:
          updateUser needs a session, and an unconfirmed account has none. So
          signing up again IS the supported route — the person just has to be
          told it exists, which is the whole reason this line is here. */}
      <p className="mt-2 text-sm text-muted-foreground">
        טעיתם בכתובת המייל?{' '}
        <Link href="/auth/signup" className="font-medium text-primary hover:underline">
          הירשמו שוב עם הכתובת הנכונה
        </Link>
        .
      </p>
    </>
  );
}

// `next`: where to resume after sign-in (e.g. the OAuth consent page). The
// login action re-validates it server-side — the hidden field is never trusted.
export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(login, {});

  return (
    <>
      <form action={action} className="space-y-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {/* The unconfirmed-account line comes back as data, next to the address it is about. */}
        <FormError message={actionFormError(state) ?? state.data?.error} />

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
          <FieldError errors={state.validationErrors?.fieldErrors?.password} />
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

      {state.data?.unconfirmedEmail ? (
        <ResendConfirmation email={state.data.unconfirmedEmail} />
      ) : null}
    </>
  );
}
