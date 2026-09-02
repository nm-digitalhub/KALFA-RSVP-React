'use client';

import { useActionState, useMemo } from 'react';
import Link from 'next/link';

import { signup } from '../actions';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { PasswordField } from './password-field';

export function SignupForm({ salesRef }: { salesRef?: string }) {
  // The sales-attribution ref travels via `bind`, NOT a hidden input. Both put
  // the value in the client bundle, but only bind protects its INTEGRITY:
  // "Variables captured by an inline action are encrypted before being sent to
  // the client" (node_modules/next/dist/docs/01-app/02-guides/server-actions.md),
  // whereas the docs warn a hidden field's "value will be part of the rendered
  // HTML and will not be encoded" (02-guides/forms.md). With a hidden field a
  // viewer could retype the token as ANOTHER lead's real attempt id and claim
  // their conversion; encrypted, it cannot be edited at all.
  //
  // Confidentiality is NOT the point — the ref is in the URL either way. This
  // is about tamper-resistance, and it does not replace the server-side
  // re-verification in actions.ts ("Framework protections are not a substitute
  // for application-level checks", same docs page).
  //
  // Memoized so the action identity stays stable across re-renders.
  const boundSignup = useMemo(() => signup.bind(null, salesRef), [salesRef]);
  const [state, action] = useActionState(boundSignup, null);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div>
        <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
          שם מלא
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          required
          className="w-full rounded-md border border-border bg-transparent px-3 py-3"
        />
        <FieldError errors={state?.fieldErrors?.full_name} />
      </div>

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
          dir="ltr"
          className="w-full rounded-md border border-border bg-transparent px-3 py-3"
        />
        <FieldError errors={state?.fieldErrors?.email} />
      </div>

      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium">
          טלפון <span className="text-muted-foreground">(אופציונלי)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          dir="ltr"
          className="w-full rounded-md border border-border bg-transparent px-3 py-3"
        />
        <FieldError errors={state?.fieldErrors?.phone} />
      </div>

      <PasswordField fieldErrors={state?.fieldErrors?.password} />

      <div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="terms_accepted"
            required
            className="mt-0.5 size-4 rounded border-input"
          />
          <span>
            קראתי ואני מסכים/ה ל
            <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
              תנאי השימוש
            </Link>{' '}
            ול
            <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">
              מדיניות הפרטיות
            </Link>
          </span>
        </label>
        <FieldError errors={state?.fieldErrors?.terms_accepted} />
      </div>

      <SubmitButton size="lg">הרשמה</SubmitButton>
    </form>
  );
}
