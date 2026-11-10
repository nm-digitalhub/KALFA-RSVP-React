import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { getGiftByToken } from '@/lib/data/gift';
import { getT } from '@/i18n.server';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

import { GiftLanding } from './gift-landing';
import { GuestAlert } from '@/components/guest/guest-alert';
import { GuestShell } from '@/components/guest/guest-shell';

import { inviteImageUrlOrNull } from '../../invite-image-url';

// Always render per-request: the response depends on the token and must never
// be cached or prerendered. Response headers (no-store, no-referrer, noindex)
// are set for `/g/:token*` in next.config.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  return {
    title: t('g.meta.title', 'שליחת מתנה'),
    // Link-only page — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

// The gift token is exactly 32 hex chars (encode(gen_random_bytes(16),'hex')).
// Reject anything else before touching the DB.
const TOKEN_RE = /^[0-9a-f]{32}$/;
const GIFT_VIEW_RATE = { limit: 30, windowMs: 60_000 };

export default async function GiftPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { t } = await getT('public');
  const { token } = await params;

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  // Bucket key uses a token FINGERPRINT, never the raw bearer token (raw
  // tokens in in-memory keys can surface in diagnostics; same pattern as
  // r/[token]/page.tsx).
  const fp = tokenFingerprint(token);
  const gate = await rateLimit(`gift:view:${fp}:${ip}`, GIFT_VIEW_RATE);
  if (!gate.allowed) {
    return (
      <GuestShell>
        <GuestAlert tone="warning">
          {t('g.rateLimited', 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.')}
        </GuestAlert>
      </GuestShell>
    );
  }

  const view = TOKEN_RE.test(token) ? await getGiftByToken(token) : null;
  if (!view) {
    // One generic message for unknown / inactive / no-link — never reveal which,
    // to avoid leaking token validity.
    return (
      <GuestShell>
        <GuestAlert tone="error">
          {t('g.invalidLink', 'הקישור אינו תקף או שאינו זמין עוד.')}
        </GuestAlert>
      </GuestShell>
    );
  }

  // Invitation-image hero: sign a short-lived URL AFTER the token resolved to a
  // valid, active event (the bucket is private). Fail-open — render without the
  // image on any signing hiccup.
  const inviteImageUrl = await inviteImageUrlOrNull(view.invite_image_path, view.id, 'gift');

  return (
    <GuestShell>
      <GiftLanding view={view} token={token} inviteImageUrl={inviteImageUrl} />
    </GuestShell>
  );
}
