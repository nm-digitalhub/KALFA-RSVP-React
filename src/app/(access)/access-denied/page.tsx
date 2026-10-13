import type { Metadata } from 'next';
import Link from 'next/link';

import { requireUser } from '@/lib/auth/dal';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'אין הרשאה',
  robots: { index: false, follow: false },
};

export default async function AccessDeniedPage() {
  const user = await requireUser();

  return (
    <main dir="rtl" className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <section
        aria-labelledby="denied-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-10"
      >
        <p className="text-sm font-medium text-primary">הגישה מוגבלת</p>
        <h1 id="denied-title" className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">
          אין לך הרשאה לעמוד הזה
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          החשבון שמחובר כעת אינו מורשה לפתוח את העמוד או לבצע את הפעולה שביקשת.
        </p>
        {user.email && (
          <div className="mt-6 rounded-xl bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">החשבון המחובר</p>
            <p dir="ltr" className="mt-1 break-all text-sm">{user.email}</p>
          </div>
        )}
        <div className="mt-8 flex flex-col gap-3">
          <Link href="/app/events" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
            חזרה לאירועים
          </Link>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}
            >
              יציאה מהחשבון
            </button>
          </form>
        </div>
        <p className="mt-6 text-sm leading-6 text-muted-foreground">
          אם הגישה דרושה לך במסגרת התפקיד, פנה לבעל המערכת לבדיקת ההרשאות.
        </p>
      </section>
    </main>
  );
}
