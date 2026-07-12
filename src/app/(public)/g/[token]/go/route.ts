import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

// The actual gift redirect, reached from the "send a gift" button on the
// `/g/[token]` landing page (and directly from the WhatsApp URL button for
// backward compatibility). PII-free by construction — the opaque token maps to
// ONE event's owner-provided PayBox/Bit URL and nothing else is readable here.
// Every failure mode (unknown token, unpublished event, no link) is the same
// generic 404, privacy-safe like the public RSVP routes. Route Handlers are not
// cached by default, and reading headers() keeps this request-time.

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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('events')
    .select('status, gift_payment_url')
    .eq('gift_link_token', token)
    .maybeSingle();
  if (error || !data) return new NextResponse(null, { status: 404 });

  const url =
    typeof data.gift_payment_url === 'string' ? data.gift_payment_url.trim() : '';
  // Only a PUBLISHED event circulates gift links; https re-checked so a bad
  // value can never become an open redirect to plain http.
  if (data.status !== 'active' || !/^https:\/\//i.test(url)) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.redirect(url, 302);
}
