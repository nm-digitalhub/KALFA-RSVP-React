import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { signOneTimeKeyForWidget } from '@/lib/data/widget-sdk-auth';

// POST /api/widget/sdk-auth   body: { one_time_key }  →  { hash, username }
//
// PUBLIC counterpart to /api/agents/sdk-auth — same one-time-key protocol,
// but for the widget's shared identity instead of a session-authenticated
// agent. There is deliberately NO auth gate here (an anonymous visitor has
// no session to gate on — that is the entire premise of the widget); the
// bound is a per-IP rate limit, tighter than the agent route's per-user 10/
// min, since this endpoint is reachable by anyone who finds it, not just
// real widget users. Obtaining a hash is NOT the expensive step (it costs
// nothing to sign) — it only lets a caller attempt a Voximplant login, which
// costs at most the shared identity's MAU (already 1/month regardless of
// volume) plus whatever the platform itself rate-limits at the login layer.
// The real cost surface — PLACING a call — is bounded separately and
// authoritatively at call-intent/widget-authorize (evaluateWidgetCallCaps),
// never here.
//
// 503 when the shared identity isn't provisioned yet (WIDGET_VOX_USERNAME/
// WIDGET_VOX_PASSWORD unset) — same fail-closed shape as route-inbound's
// `if (!expected) return json(REJECT, 503)` for KALFA_CONSOLE_SECRET.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 2_048;

// Same charset/length bound as agents/sdk-auth — Voximplant's key is an
// opaque token; a hostile body must never become a long/structured input to
// the hash.
const bodySchema = z.strictObject({
  one_time_key: z
    .string()
    .trim()
    .min(8)
    .max(256)
    .regex(/^[A-Za-z0-9._~+/=-]+$/, 'one_time_key has unexpected characters'),
});

// Tighter than the agent route's 10/min (per-user, post-auth): this has no
// auth gate at all, so IP is the only defense. A real widget tab signs once
// per session, not repeatedly — 5/min per IP comfortably covers retries
// after a network blip without being useful to a script grinding keys.
const RATE = { limit: 5, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  const gate = rateLimit(`widget-sdk-auth:${ip}`, RATE);
  if (!gate.allowed) {
    return json({ error: 'יותר מדי בקשות — נסו שוב בעוד רגע' }, 429);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'בקשה גדולה מדי' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }

  const result = bodySchema.safeParse(parsed);
  // Generic message on purpose — echoing why a key was rejected tells a
  // prober about the format (same reasoning as agents/sdk-auth).
  if (!result.success) return json({ error: 'מפתח חד-פעמי אינו תקין' }, 400);

  const signed = signOneTimeKeyForWidget(result.data.one_time_key);
  if (!signed.ok) {
    return json({ error: 'זהות הווידג׳ט אינה מוגדרת עדיין' }, 503);
  }

  // The hash and nothing else — same discipline as agents/sdk-auth. The
  // client already knows the username (NEXT_PUBLIC_WIDGET_VOX_USERNAME,
  // build-time public config — see widget-sdk-auth.ts's header for why it
  // must know it BEFORE calling this route, not learn it from the response).
  return json({ hash: signed.hash }, 200);
}
