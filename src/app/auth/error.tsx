'use client';

import Link from 'next/link';

import { RouteErrorView, routeErrorSecondaryActionClass } from '@/components/route-error-view';

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
  return (
    <RouteErrorView
      error={error}
      retry={retry}
      secondaryAction={
        <Link href="/auth/login" className={routeErrorSecondaryActionClass}>
          לדף ההתחברות
        </Link>
      }
    />
  );
}
