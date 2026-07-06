import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { RSVP_READ_RATE, RSVP_TOKEN_MIN_LENGTH } from '@/lib/constants';
import { getRsvpByToken } from '@/lib/data/rsvp';
import { signedInviteImageUrl } from '@/lib/storage/event-media';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

import { RsvpForm } from './rsvp-form';

// Always render per-request: the response is guest-specific and must never be
// cached or prerendered. Response headers (no-store, no-referrer) are set for
// `/r/:token*` in next.config.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'אישור הגעה',
  // Personal, link-only page — keep it out of search indexes.
  robots: { index: false, follow: false },
};

// Cheap shape guard so obviously-malformed tokens are rejected before any DB
// work. The canonical token is 32 hex chars; we stay lenient (length + opaque
// charset) to tolerate any legacy value while still blocking junk input.
function looksLikeToken(token: string): boolean {
  return (
    token.length >= RSVP_TOKEN_MIN_LENGTH &&
    token.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-12">
      {children}
    </main>
  );
}

export default async function RsvpPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  const gate = rateLimit(`rsvp:read:${token}:${ip}`, RSVP_READ_RATE);
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

  const view = looksLikeToken(token) ? await getRsvpByToken(token) : null;
  if (!view) {
    // One generic message for unknown / revoked / expired / inactive — never
    // reveal which, to avoid leaking token validity.
    return (
      <Shell>
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          קישור אישור ההגעה אינו תקף, פג תוקפו או בוטל.
        </p>
      </Shell>
    );
  }

  // Invitation-image hero: sign a short-lived URL AFTER the token resolved to
  // a valid view (the bucket is private; the token holder is exactly the guest
  // this invitation was sent to). Fail-open — the page renders without the
  // image on any signing hiccup.
  let inviteImageUrl: string | null = null;
  if (view.event.invite_image_path) {
    try {
      inviteImageUrl = await signedInviteImageUrl(view.event.invite_image_path, 600);
    } catch (err) {
      console.error(
        `[event-media] rsvp invite image signing failed (event=${view.event.id}): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  return (
    <Shell>
      <RsvpForm token={token} view={view} inviteImageUrl={inviteImageUrl} />
    </Shell>
  );
}
