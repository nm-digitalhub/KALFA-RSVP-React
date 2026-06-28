'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ACTIVE_ORG_COOKIE } from '@/lib/auth/dal';
import { acceptInvitation } from '@/lib/data/orgs';

function isNextRedirect(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

// Accept an invitation for the signed-in user, set the joined org as active,
// and land on the app. On any failure we redirect back to the join page with a
// generic, privacy-safe error (never leak why the token is invalid).
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!token) {
    redirect('/app');
  }

  let orgId: string;
  try {
    orgId = await acceptInvitation(token);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/join/${encodeURIComponent(token)}?error=1`);
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  redirect('/app');
}
