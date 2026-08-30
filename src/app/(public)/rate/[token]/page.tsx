import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { getRatingByToken } from '@/lib/data/inquiry-rating';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { RATING_VIEW_RATE } from '@/lib/constants';

import { RatingForm } from './rating-form';

// Always render per-request: the response depends on the token and must
// never be cached or prerendered. Response headers (no-store, no-referrer,
// noindex) are set for `/rate/:token*` in next.config.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'דירוג שירות',
  // Link-only page — keep it out of search indexes.
  robots: { index: false, follow: false },
};

// rating_token is exactly 32 hex chars (randomBytes(16).toString('hex')) —
// no legacy generation path to tolerate, unlike guests.rsvp_token, so the
// strict shape (not r/[token]'s lenient one) applies from day one.
const TOKEN_RE = /^[0-9a-f]{32}$/;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-4 py-10">
      {children}
    </main>
  );
}

const VALID_SCORES = new Set(['1', '2', '3']);

export default async function RatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ score?: string }>;
}) {
  const { token } = await params;
  const { score } = await searchParams;
  // Pre-select the score the customer already clicked in the email — the
  // link itself never mutates anything (GET), it only primes the form so
  // they don't have to pick again; submitting still requires the button.
  const initialScore = score && VALID_SCORES.has(score) ? (Number(score) as 1 | 2 | 3) : null;

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  // Bucket key uses a token FINGERPRINT, never the raw bearer token — same
  // pattern as every other public token surface (r/g/[token]/page.tsx).
  const fp = tokenFingerprint(token);
  const gate = rateLimit(`rating:view:${fp}:${ip}`, RATING_VIEW_RATE);
  if (!gate.allowed) {
    return (
      <Shell>
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.
        </p>
      </Shell>
    );
  }

  const view = TOKEN_RE.test(token) ? await getRatingByToken(token) : null;
  if (!view) {
    // One generic message for unknown / never-requested / DB error — never
    // reveal which, to avoid leaking token validity.
    return (
      <Shell>
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          הקישור אינו תקף או שאינו זמין עוד.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <RatingForm token={token} initialScore={initialScore} />
    </Shell>
  );
}
