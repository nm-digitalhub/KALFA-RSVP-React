import type { Metadata } from 'next';
import Link from 'next/link';

import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'הרשמה' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">הרשמה</h1>
        <p className="text-sm text-muted-foreground">צרו חשבון כדי להתחיל לנהל אירועים</p>
      </div>

      <SignupForm salesRef={typeof ref === 'string' ? ref : undefined} />

      <p className="text-center text-sm text-muted-foreground">
        כבר יש לכם חשבון?{' '}
        <Link href="/auth/login" className="font-medium text-primary hover:underline">
          התחברות
        </Link>
      </p>
    </main>
  );
}
