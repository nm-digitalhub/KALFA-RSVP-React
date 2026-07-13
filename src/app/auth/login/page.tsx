import Link from 'next/link';

import { LoginForm } from './login-form';
import { PasskeySignInButton } from './passkey-sign-in-button';

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">התחברות</h1>
        <p className="text-sm text-muted-foreground">התחברו כדי לנהל את האירועים שלכם</p>
      </div>

      <LoginForm />

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        או
        <span className="h-px flex-1 bg-border" />
      </div>

      <PasskeySignInButton />

      <p className="text-center text-sm text-muted-foreground">
        אין לכם חשבון?{' '}
        <Link href="/auth/signup" className="font-medium text-primary hover:underline">
          הרשמה
        </Link>
      </p>
    </main>
  );
}
