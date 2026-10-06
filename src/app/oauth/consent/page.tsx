import type { Metadata } from 'next';

import { OAuthConsent } from '@/components/oauth-consent';

// Supabase OAuth 2.1 server authorization path (Dashboard → Authentication →
// OAuth Server → Authorization Path = /oauth/consent). Supabase Auth sends the
// user here with ?authorization_id=… after validating the client's request.
// From the Supabase UI Library `oauth-consent-nextjs` block. Deliberately NOT in
// the proxy's PROTECTED_PREFIXES: an anonymous visitor must reach this page so
// the sign-in redirect can carry the full URL (authorization_id) in `next`.
export const metadata: Metadata = {
  title: 'אישור גישה',
  robots: { index: false, follow: false },
};

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
}) {
  const { authorization_id } = await searchParams;
  const authorizationId = typeof authorization_id === 'string' ? authorization_id : null;

  return (
    <main className="flex min-h-svh items-center justify-center p-6 md:p-10">
      <OAuthConsent className="w-full max-w-lg" authorizationId={authorizationId} />
    </main>
  );
}
