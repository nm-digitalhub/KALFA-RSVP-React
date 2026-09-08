import { headers } from 'next/headers';

import { buildCalendarEvent, renderIcs } from '@/lib/calendar/event-calendar';
import { icsResponse } from '@/lib/calendar/ics-response';
import { RSVP_READ_RATE } from '@/lib/constants';
import { getRsvpByToken, looksLikeRsvpToken } from '@/lib/data/rsvp';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

// The RSVP page's calendar file: `/r/[token]/event.ics`, linked from the
// add-to-calendar menu shown after a guest confirms attendance. See
// g/[token]/event.ics/route.ts for why the response is inline text/calendar.
//
// Security shape (same token space and gates as the page):
//   - the guest's existing RSVP token, shape-checked by looksLikeRsvpToken then
//     resolved through get_rsvp_by_token (the RPC keys on the exact value; no
//     listing or enumeration); any failure is one generic 404;
//   - rate-limited per token FINGERPRINT + IP with the page's read rate;
//   - the file carries ONLY event fields the page already renders — the
//     guest's name, phone, status, answers and notes never enter it (the ICS
//     is the same for every guest of the event);
//   - no-store / noindex / no-referrer headers (also set for `/r/:token*` in
//     next.config).

// IP-only bucket with the /go limit (one client probing many tokens); the
// per-token bucket keeps the page's read rate.
const RSVP_ICS_IP_RATE = { limit: 30, windowMs: 60_000 };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!looksLikeRsvpToken(token)) return new Response(null, { status: 404 });

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  const fp = tokenFingerprint(token);
  const perToken = rateLimit(`rsvp:ics:${fp}:${ip}`, RSVP_READ_RATE);
  const perIp = rateLimit(`rsvp:ics:ip:${ip}`, RSVP_ICS_IP_RATE);
  if (!perToken.allowed || !perIp.allowed) return new Response(null, { status: 429 });

  // getRsvpByToken throws on an RPC error (the page shows an error state); this
  // route answers the same generic 404 as for an unknown token — no detail leaks.
  let view;
  try {
    view = await getRsvpByToken(token);
  } catch (err) {
    console.error(`[calendar] rsvp ics lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return new Response(null, { status: 404 });
  }
  if (!view) return new Response(null, { status: 404 });

  const built = buildCalendarEvent({
    name: view.event.name,
    event_type: view.event.event_type,
    event_date: view.event.event_date,
    venue_name: view.event.venue_name,
    venue_address: view.event.venue_address,
    celebrants: view.event.celebrants,
  });
  if (!built) return new Response(null, { status: 404 });

  try {
    // UID seed = the internal event id (hashed one-way in calendarUid), the same
    // for every guest of the event — the file carries no guest or token data.
    return icsResponse(renderIcs(built, view.event.id), built.fileName);
  } catch (err) {
    console.error(`[calendar] rsvp ics generation failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    return new Response(null, { status: 404 });
  }
}
