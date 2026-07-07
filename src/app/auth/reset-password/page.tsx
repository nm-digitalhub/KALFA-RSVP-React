import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';

// Reached after /auth/confirm (verifyOtp type=recovery) has established a session.
// getUser() verifies that session with the Auth server; without a valid one the
// recovery link was invalid / expired / already used, so we guide the user to
// request a fresh one instead of showing a form that cannot succeed.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">קביעת סיסמה חדשה</h1>
        <p className="text-sm text-muted-foreground">
          {user
            ? 'בחרו סיסמה חדשה לחשבונכם.'
            : 'קישור האיפוס אינו תקף או שפג תוקפו.'}
        </p>
      </div>

      {user ? (
        <ResetPasswordForm />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/auth/forgot-password"
            className="font-medium text-primary hover:underline"
          >
            בקשת קישור איפוס חדש
          </Link>
        </p>
      )}
    </main>
  );
}
