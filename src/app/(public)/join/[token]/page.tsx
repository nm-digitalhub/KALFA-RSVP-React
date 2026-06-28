import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getUser } from '@/lib/auth/dal';
import { getInvitationPreview } from '@/lib/data/orgs';

import { acceptInvitationAction } from './actions';

export const metadata = { title: 'הצטרפות לארגון' };

// Public invitation-acceptance page. Requires login (redirects to /auth/login
// with a return path). Shows the org behind a still-valid token and a single
// confirm button; invalid/expired/used tokens get a generic, privacy-safe
// message — never the reason.
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const user = await getUser();
  if (!user) {
    redirect(`/auth/login?next=${encodeURIComponent(`/join/${token}`)}`);
  }

  const preview = await getInvitationPreview(token);

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-bold">הצטרפות לצוות</h1>

      {!preview ? (
        <div className="space-y-4">
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            ההזמנה אינה תקפה, פגה או כבר נוצלה.
          </p>
          <Link
            href="/app"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            חזרה לאזור האישי
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              ההצטרפות נכשלה. ייתכן שההזמנה כבר אינה תקפה.
            </p>
          ) : null}
          <p className="text-muted-foreground">
            הוזמנת להצטרף לארגון{' '}
            <span className="font-semibold text-foreground">{preview.orgName}</span>.
          </p>
          <form action={acceptInvitationAction}>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              הצטרפות
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
