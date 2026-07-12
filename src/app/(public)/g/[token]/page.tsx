import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { getGiftByToken } from '@/lib/data/gift';
import { signedInviteImageUrl } from '@/lib/storage/event-media';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

import { GiftLanding } from './gift-landing';

// Always render per-request: the response depends on the token and must never
// be cached or prerendered. Response headers (no-store, no-referrer, noindex)
// are set for `/g/:token*` in next.config.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'שליחת מתנה',
  // Link-only page — keep it out of search indexes.
  robots: { index: false, follow: false },
};

// The gift token is exactly 32 hex chars (encode(gen_random_bytes(16),'hex')).
// Reject anything else before touching the DB.
const TOKEN_RE = /^[0-9a-f]{32}$/;
const GIFT_VIEW_RATE = { limit: 30, windowMs: 60_000 };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-4 py-10">
      {children}
    </main>
  );
}

export default async function GiftPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  const gate = rateLimit(`gift:view:${token}:${ip}`, GIFT_VIEW_RATE);
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

  const view = TOKEN_RE.test(token) ? await getGiftByToken(token) : null;
  if (!view) {
    // One generic message for unknown / inactive / no-link — never reveal which,
    // to avoid leaking token validity.
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
        `[event-media] gift invite image signing failed (event=${view.id}): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  return (
    <Shell>
      <GiftLanding view={view} token={token} inviteImageUrl={inviteImageUrl} />
    </Shell>
  );
}
