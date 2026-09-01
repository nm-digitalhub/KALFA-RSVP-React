'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { signup } from '../actions';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { PasswordField } from './password-field';

export function SignupForm({ salesRef }: { salesRef?: string }) {
  const [state, action] = useActionState(signup, null);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      {salesRef && <input type="hidden" name="ref" value={salesRef} />}

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
