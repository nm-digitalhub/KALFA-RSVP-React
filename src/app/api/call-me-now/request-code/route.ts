import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { requestOtp } from '@/lib/data/otp';
import { CALL_ME_NOW_OTP_PURPOSE, callMeNowRequestCodeBodySchema } from '@/lib/validation/call-me-now';

// POST /api/call-me-now/request-code   body: { phone }   →   { ok, error? }
//
// PUBLIC — the visitor names an arbitrary phone number here, unauthenticated.
// otp.ts's requestOtp is reused UNCHANGED (same function agreement-signing
// already uses in production) — it is purpose-keyed and takes a raw phone,
// so it works for a public caller with zero changes. But every EXISTING call
// site is authenticated and can only ever request a code for its OWN profile
// phone; this route accepts an ATTACKER-NAMED number. requestOtp's own limit
// (5 codes/phone/purpose/hour, otp.ts's RATE_MAX/RATE_WINDOW_MS) caps hitting
// ONE victim repeatedly, but does nothing against an attacker rotating
// destination numbers from a single IP to burn SMS budget or harass
// strangers — hence the per-IP flood guard below, layered on top, same class
// of admission discipline as every other public call-center entry point in
// this project (widget/call-intent, route-inbound's coarse guard).
//
// OTP_PURPOSE is its own value ('call_me_now'), distinct from
// agreements.ts's 'agreement_signing' — otp_challenges rate-limits and looks
// up per (phone, purpose), so the two flows can never interfere with or
// count against each other for the same phone.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 512;
// Looser than requestOtp's own 5/phone/hour (that is the real per-victim
// cap) — this is the coarse per-IP flood guard against ROTATING destination
// numbers from one source. Loose enough that a real visitor mistyping their
// number twice never trips it.
const FLOOD_RATE = { limit: 10, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`call-me-now-request-code:${ip}`, FLOOD_RATE).allowed) {
    return json({ ok: false, error: 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.' }, 429);
  }

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'בקשה גדולה מדי' }, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ ok: false, error: 'בקשה גדולה מדי' }, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'גוף הבקשה אינו תקין' }, 400);
  }
  const parsed = callMeNowRequestCodeBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json({ ok: false, error: 'מספר טלפון לא תקין' }, 400);

  const res = await requestOtp(parsed.data.phone, CALL_ME_NOW_OTP_PURPOSE);
  if (!res.ok) return json({ ok: false, error: res.error ?? 'שליחת קוד האימות נכשלה' }, 200);
  return json({ ok: true }, 200);
}
