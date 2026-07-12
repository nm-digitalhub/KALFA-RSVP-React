import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { getThankyouByToken } from '@/lib/data/thankyou';
import { signedInviteImageUrl } from '@/lib/storage/event-media';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

import { ThankyouLanding } from './thankyou-landing';

// Always render per-request: the response depends on the token and must never
// be cached or prerendered. Response headers (no-store, no-referrer, noindex)
// are set for `/ty/:token*` in next.config.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'תודה',
  // Link-only page — keep it out of search indexes.
  robots: { index: false, follow: false },
};

// The gift token (reused here) is exactly 32 hex chars
// (encode(gen_random_bytes(16),'hex')). Reject anything else before touching the DB.
const TOKEN_RE = /^[0-9a-f]{32}$/;
const THANKYOU_VIEW_RATE = { limit: 30, windowMs: 60_000 };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-4 py-10">
      {children}
    </main>
  );
}

export default async function ThankyouPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  const gate = rateLimit(`ty:view:${token}:${ip}`, THANKYOU_VIEW_RATE);
  if (!gate.allowed) {
    return (
      <Shell>
        <p
          role="alert"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.
        </p>
      </Shell>
    );
  }

  const view = TOKEN_RE.test(token) ? await getThankyouByToken(token) : null;
  if (!view) {
    // One generic message for unknown / inactive — never reveal which, to avoid
    // leaking token validity.
    return (
      <Shell>
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          הקישור אינו תקף או שאינו זמין עוד.
        </p>
      </Shell>
    );
  }

  // Invitation-image hero: sign a short-lived URL AFTER the token resolved to a
  // valid, active event (the bucket is private). Fail-open — render without the
  // image on any signing hiccup.
  let inviteImageUrl: string | null = null;
  if (view.invite_image_path) {
    try {
      inviteImageUrl = await signedInviteImageUrl(view.invite_image_path, 600);
    } catch (err) {
      console.error(
        `[event-media] thankyou invite image signing failed (event=${view.id}): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  return (
    <Shell>
      <ThankyouLanding view={view} inviteImageUrl={inviteImageUrl} />
    </Shell>
  );
}
