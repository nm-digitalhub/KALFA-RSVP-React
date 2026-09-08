import { headers } from 'next/headers';

import { buildCalendarEvent, renderIcs } from '@/lib/calendar/event-calendar';
import { icsResponse } from '@/lib/calendar/ics-response';
import { getGiftByToken } from '@/lib/data/gift';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

// The gift page's calendar file: `/g/[token]/event.ics`, linked from the
// "יומן Apple" / "קובץ יומן" rows of the shared add-to-calendar menu. iOS
// Safari renders an inline `text/calendar` response as the Calendar preview
// ("Add All") — the one path that opens the event in Calendar from a web page
// rather than looking like a file download.
//
// Security shape (same token space and gates as the page and /go):
//   - the token is the existing 32-hex gift token, validated by shape then
//     resolved through getGiftByToken (active event with a payment link only);
//     any failure is one generic 404;
//   - rate-limited per token FINGERPRINT + IP (never the raw token in a key);
//   - the file carries ONLY event fields the page already renders (title,
//     date/time, venue) — no guest data, no payment URL, no owner identity;
//   - no-store / noindex / no-referrer headers (also set for `/g/:token*` in
//     next.config); Route Handlers are dynamic by default and headers() keeps
//     this request-time.
const TOKEN_RE = /^[0-9a-f]{32}$/;
// Same limit as /g/[token]/go. Two buckets: per token-fingerprint + IP (one guest
// hammering one link) and per IP alone (one client probing many tokens).
const GIFT_ICS_RATE = { limit: 30, windowMs: 60_000 };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return new Response(null, { status: 404 });

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  const fp = tokenFingerprint(token);
  const perToken = rateLimit(`gift:ics:${fp}:${ip}`, GIFT_ICS_RATE);
  const perIp = rateLimit(`gift:ics:ip:${ip}`, GIFT_ICS_RATE);
  if (!perToken.allowed || !perIp.allowed) return new Response(null, { status: 429 });

  // getGiftByToken already collapses every failure to null (generic 404).
  const view = await getGiftByToken(token);
  if (!view) return new Response(null, { status: 404 });

  const built = buildCalendarEvent({
    name: view.name,
    event_type: view.event_type,
    event_date: view.event_date,
    venue_name: view.venue_name,
    venue_address: view.venue_address,
    celebrants: view.celebrants,
  });
  if (!built) return new Response(null, { status: 404 });

  try {
    // UID seed = the internal event id, one-way hashed inside calendarUid — the
    // file never carries the id itself nor the token.
    return icsResponse(renderIcs(built, view.id), built.fileName);
  } catch (err) {
    console.error(
      `[calendar] gift ics generation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return new Response(null, { status: 404 });
  }
}
