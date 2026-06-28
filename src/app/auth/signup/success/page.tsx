import Link from 'next/link';
import { MailCheck } from 'lucide-react';

export const metadata = { title: 'ההרשמה הצליחה' };

// Post-signup interstitial shown after a successful registration that requires
// email confirmation. The signup action redirects here instead of showing an
// inline notice. The actual confirmation happens when the user clicks the email
// link (handled by /auth/callback). No personal data is passed in the URL.
export default function SignupSuccessPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-7" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold">ההרשמה הצליחה!</h1>
      </div>

      <div className="space-y-3 text-sm text-muted-foreground">
        <p>שלחנו אליך אימייל לאישור החשבון.</p>
        <p>
          כדי להפעיל את החשבון, פתח/י את ההודעה ולחץ/י על קישור האישור. לאחר מכן
          תוכל/י להתחבר.
        </p>
        <p className="text-xs">
          לא רואה את האימייל? בדוק/י את תיקיית הספאם או הקידום, או נסה/י להירשם שוב.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href="/auth/login"
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          מעבר להתחברות
        </Link>
        <Link
          href="/auth/signup"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          הרשמה מחדש
        </Link>
      </div>
    </main>
  );
}
