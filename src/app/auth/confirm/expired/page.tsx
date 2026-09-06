import type { Metadata } from 'next';
import Link from 'next/link';

import { isConfirmOtpType } from '../otp-types';
import { ResendConfirmationForm } from './resend-form';

export const metadata: Metadata = { title: 'הקישור פג תוקף' };

// Where a dead auth link lands, instead of dumping the user on /auth/login with
// no explanation of what just happened.
//
// Why this page rather than a longer link lifetime: mailer_otp_exp is a SINGLE
// project-wide setting — Supabase exposes no separate expiry for confirmation,
// recovery, magic-link and invite — and their production checklist puts the
// recommended ceiling at 3600s, which is exactly where it sits. Raising it to
// survive an overnight gap would also stretch password-reset links. Supabase's
// own answer to expired/prefetched links is a landing page the user acts from,
// which is what /auth/confirm already is; this completes it for the failure path.
//
// `type` decides what recovery to offer and comes from the link the visitor
// already held — never from anything we know about them. Anything unrecognised
// degrades to the generic message.
export default async function ConfirmExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.type === 'string' ? sp.type : '';
  const type = isConfirmOtpType(raw) ? raw : null;

  // 'email' and 'invite' land here through the same signup-confirmation path.
  const isSignupLike = type === 'signup' || type === 'email' || type === 'invite';
  const isRecovery = type === 'recovery';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">הקישור פג תוקף</h1>
        <p className="text-sm text-muted-foreground">
          {isRecovery
            ? 'קישורי איפוס סיסמה תקפים לזמן מוגבל, וגם נשרפים אחרי שימוש אחד. אפשר לבקש קישור חדש.'
            : isSignupLike
              ? 'קישורי אימות תקפים לזמן מוגבל, וגם נשרפים אחרי שימוש אחד. נשלח לכם קישור חדש — הפעם כדאי לפתוח אותו סמוך לקבלה.'
              : 'הקישור כבר אינו תקף. ייתכן שפג תוקפו או שכבר נעשה בו שימוש.'}
        </p>
      </div>

      {isSignupLike ? (
        <div>
          <ResendConfirmationForm />
      <p className="mt-2 text-sm text-muted-foreground">
            טעיתם בכתובת המייל?{' '}
            <Link href="/auth/signup" className="font-medium text-primary hover:underline">
              הירשמו שוב עם הכתובת הנכונה
            </Link>
            .
          </p>
        </div>
      ) : null}

      {isRecovery ? (
        <Link
          href="/auth/forgot-password"
          className="text-sm font-medium text-primary hover:underline"
        >
          בקשת קישור איפוס חדש
        </Link>
      ) : null}

      <Link href="/auth/login" className="text-sm text-muted-foreground hover:underline">
        חזרה למסך ההתחברות
      </Link>
    </main>
  );
}
