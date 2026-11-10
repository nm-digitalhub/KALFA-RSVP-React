import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { getThankyouByToken } from '@/lib/data/thankyou';
import { getT } from '@/i18n.server';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

import { ThankyouLanding } from './thankyou-landing';
import { GuestAlert } from '@/components/guest/guest-alert';
import { GuestShell } from '@/components/guest/guest-shell';

import { inviteImageUrlOrNull } from '../../invite-image-url';

// Always render per-request: the response depends on the token and must never
// be cached or prerendered. Response headers (no-store, no-referrer, noindex)
// are set for `/ty/:token*` in next.config.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  return {
    title: t('ty.meta.title', 'תודה'),
    // Link-only page — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

// The gift token (reused here) is exactly 32 hex chars
// (encode(gen_random_bytes(16),'hex')). Reject anything else before touching the DB.
const TOKEN_RE = /^[0-9a-f]{32}$/;
const THANKYOU_VIEW_RATE = { limit: 30, windowMs: 60_000 };

export default async function ThankyouPage({
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
  const gate = await rateLimit(`ty:view:${fp}:${ip}`, THANKYOU_VIEW_RATE);
  if (!gate.allowed) {
    return (
      <GuestShell>
        <GuestAlert tone="warning">
          {t('ty.rateLimited', 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.')}
        </GuestAlert>
      </GuestShell>
    );
  }

  const view = TOKEN_RE.test(token) ? await getThankyouByToken(token) : null;
  if (!view) {
    // One generic message for unknown / inactive — never reveal which, to avoid
    // leaking token validity.
    return (
      <GuestShell>
        <GuestAlert tone="error">
          {t('ty.invalidLink', 'הקישור אינו תקף או שאינו זמין עוד.')}
        </GuestAlert>
      </GuestShell>
    );
  }

  // Invitation-image hero: sign a short-lived URL AFTER the token resolved to a
  // valid, active event (the bucket is private). Fail-open — render without the
  // image on any signing hiccup.
  const inviteImageUrl = await inviteImageUrlOrNull(view.invite_image_path, view.id, 'thankyou');

  return (
    <GuestShell>
      <ThankyouLanding view={view} inviteImageUrl={inviteImageUrl} />
    </GuestShell>
  );
}
