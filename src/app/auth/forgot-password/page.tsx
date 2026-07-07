import Link from 'next/link';

import { ForgotPasswordForm } from './forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">איפוס סיסמה</h1>
        <p className="text-sm text-muted-foreground">
          הזינו את כתובת המייל שלכם ונשלח אליכם קישור לקביעת סיסמה חדשה.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-center text-sm text-muted-foreground">
        נזכרתם בסיסמה?{' '}
        <Link href="/auth/login" className="font-medium text-primary hover:underline">
          חזרה להתחברות
        </Link>
      </p>
    </main>
  );
}
