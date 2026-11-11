import { noStoreJson as json } from '@/lib/http/no-store-json';
import { readJsonBody } from '@/lib/http/read-json-body';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { signOneTimeKeyForWidget } from '@/lib/data/widget-sdk-auth';
import { sdkOneTimeKeyBodySchema } from '@/lib/validation/sdk-one-time-key';

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
// 503 when the shared identity isn't provisioned yet (NEXT_PUBLIC_WIDGET_VOX_USERNAME/
// WIDGET_VOX_PASSWORD unset) — same fail-closed shape as route-inbound's
// `if (!expected) return json(REJECT, 503)` for KALFA_CONSOLE_SECRET.

const MAX_BODY_CHARS = 2_048;

// Tighter than the agent route's 10/min (per-user, post-auth): this has no
// auth gate at all, so IP is the only defense. A real widget tab signs once
// per session, not repeatedly — 5/min per IP comfortably covers retries
// after a network blip without being useful to a script grinding keys.
const RATE = { limit: 5, windowMs: 60_000 } as const;

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  const gate = await rateLimit(`widget-sdk-auth:${ip}`, RATE);
  if (!gate.allowed) {
    return json({ error: 'יותר מדי בקשות — נסו שוב בעוד רגע' }, 429);
  }

  const read = await readJsonBody(request, { maxSize: MAX_BODY_CHARS, measure: 'string-length' });
  if (!read.ok) return read.response;

  const result = sdkOneTimeKeyBodySchema.safeParse(read.value);
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
