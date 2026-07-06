import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

// Public gift-link redirect behind the WhatsApp template's URL button
// (kalfa_event_gift_v1: https://beta.kalfa.me/g/{{1}}, where {{1}} is
// events.gift_link_token). PII-free by construction — the opaque token maps
// to ONE event's owner-provided PayBox/Bit URL and nothing else is readable
// here. Every failure mode (unknown token, unpublished event, no link) is the
// same generic 404, privacy-safe like the public RSVP routes.

const TOKEN_RE = /^[0-9a-f]{32}$/;
const GIFT_REDIRECT_RATE = { limit: 30, windowMs: 60_000 };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return new NextResponse(null, { status: 404 });

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  const gate = rateLimit(`gift:redirect:${ip}`, GIFT_REDIRECT_RATE);
  if (!gate.allowed) return new NextResponse(null, { status: 429 });

  // Forward-compat read (the gift columns land with a pending migration):
  // stringly-typed filter + defensive narrowing, the same stance as
  // getCampaignHoldsEnabled. Service-role is correct here — a public route
  // with no session; the opaque token IS the capability, and only the
  // redirect target ever leaves.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('events')
    .select('*')
    .filter('gift_link_token', 'eq', token)
    .maybeSingle();
  if (error || !data) return new NextResponse(null, { status: 404 });

  const row = data as Record<string, unknown>;
  const url =
    typeof row.gift_payment_url === 'string' ? row.gift_payment_url.trim() : '';
  // Only a PUBLISHED event circulates gift links; https re-checked so a bad
  // value can never become an open redirect to plain http.
  if (row.status !== 'active' || !/^https:\/\//i.test(url)) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.redirect(url, 302);
}
