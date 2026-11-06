import { NextResponse } from 'next/server';

import { getT } from '@/i18n.server';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { requestOtp } from '@/lib/data/otp';
import { CALL_ME_NOW_OTP_PURPOSE, callMeNowRequestCodeBodySchema } from '@/lib/validation/call-me-now';

// POST /api/call-me-now/request-code   body: { phone, language? }   →   { ok, reason? }
//
// PUBLIC — the visitor names an arbitrary phone number here, unauthenticated.
// This route is the only caller of otp.ts's requestOtp, which is purpose-keyed
// and takes a raw phone, so the number it sends to is ATTACKER-NAMED. requestOtp's
// own limit (5 codes/phone/purpose/hour, otp.ts's RATE_MAX/RATE_WINDOW_MS) caps
// hitting ONE victim repeatedly, but does nothing against an attacker rotating
// destination numbers from a single IP to burn SMS budget or harass
// strangers — hence the per-IP flood guard below, layered on top, same class
// of admission discipline as every other public call-center entry point in
// this project (widget/call-intent, route-inbound's coarse guard).
//
// `reason` is a fixed value, as in verify/route.ts: the widget words it in the
// page's language. `language` is validated with the rest of the body; past that
// it picks the wording of the SMS only, and reaches no limit and no log. A Route
// Handler has no language of its own, so getT gets it explicitly (next-i18next
// README, "Server Components").
//
// CALL_ME_NOW_OTP_PURPOSE is its own value ('call_me_now'): otp_challenges
// rate-limits and looks up per (phone, purpose), so another purpose could never
// interfere with or count against this one for the same phone.

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
  if (!(await rateLimit(`call-me-now-request-code:${ip}`, FLOOD_RATE)).allowed) {
    return json({ ok: false, reason: 'rate_limited' }, 429);
  }

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return json({ ok: false, reason: 'body_too_large' }, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ ok: false, reason: 'body_too_large' }, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json({ ok: false, reason: 'bad_body' }, 400);
  }
  const parsed = callMeNowRequestCodeBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json({ ok: false, reason: 'invalid_phone' }, 400);

  const { t } = await getT('public', { lng: parsed.data.language });
  const res = await requestOtp(parsed.data.phone, CALL_ME_NOW_OTP_PURPOSE, (code) =>
    t('site.callMe.smsCode', 'קוד האימות שלך ל-KALFA: {{code}}', { code }),
  );
  if (!res.ok) return json({ ok: false, reason: res.reason ?? 'send_failed' }, 200);
  return json({ ok: true }, 200);
}
