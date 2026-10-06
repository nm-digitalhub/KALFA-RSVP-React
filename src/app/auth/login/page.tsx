import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from './login-form';
import { PasskeySignInButton } from './passkey-sign-in-button';

export const metadata: Metadata = {
  title: 'התחברות',
  description: 'כניסה לחשבון KALFA לניהול אישורי ההגעה של האירוע שלכם.',
};

// `next` (a flow to resume, e.g. /oauth/consent?authorization_id=…) or the
// proxy's `redirectTo` (a protected page). Only a path is passed on; both the
// login action (resolveAppRedirectPath) and the passkey button (safeNextPath)
// re-validate it before redirecting.
function pickNext(params: { next?: string | string[]; redirectTo?: string | string[] }): string | undefined {
  const raw = params.next ?? params.redirectTo;
  return typeof raw === 'string' && raw.startsWith('/') ? raw : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; redirectTo?: string | string[] }>;
}) {
  const next = pickNext(await searchParams);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">התחברות</h1>
        <p className="text-sm text-muted-foreground">התחברו כדי לנהל את האירועים שלכם</p>
      </div>

      <LoginForm next={next} />

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        או
        <span className="h-px flex-1 bg-border" />
      </div>

      <PasskeySignInButton next={next} />

      <p className="text-center text-sm text-muted-foreground">
        אין לכם חשבון?{' '}
        <Link href="/auth/signup" className="font-medium text-primary hover:underline">
          הרשמה
        </Link>
      </p>
    </main>
  );
}
