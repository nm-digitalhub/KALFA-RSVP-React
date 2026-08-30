'use client';

import Link from 'next/link';

import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { isVersionSkewError } from '@/lib/version-skew';

// Error boundary for /auth/* (login, signup, forgot/reset-password, confirm).
// Expected failures here (wrong password, weak password, etc.) are already
// handled inline via useActionState in each form — verified in login-form.tsx
// — so this boundary only ever fires for a genuine unexpected bug. A stuck
// login/signup page with no way out is worse than elsewhere in the app: this
// IS the entry point, so retry alone is not enough — a way back to the login
// page is offered as an escape hatch alongside it. Same generic, privacy-safe
// message and version-skew handling as the other boundaries.
export default function AuthError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useVersionSkewReload(error);
  if (isVersionSkewError(error)) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-xl font-bold">המערכת התעדכנה</h1>
        <p className="text-muted-foreground">הדף נטען מחדש…</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-bold">משהו השתבש</h1>
      <p className="text-muted-foreground">
        אירעה תקלה בטעינת הדף. אפשר לנסות שוב, ואם הבעיה נמשכת נסו שוב מאוחר יותר.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          נסו שוב
        </button>
        <Link
          href="/auth/login"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          לדף ההתחברות
        </Link>
      </div>
    </div>
  );
}
