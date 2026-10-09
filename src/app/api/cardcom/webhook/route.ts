import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { settleCardcomSession } from '@/lib/payments/cardcom-settle';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

// CardCom's webhook: it reports that a payment session ended (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// 4.5). Server-to-server and UNAUTHENTICATED — there is no session, no CSRF token and no signature to check, and CardCom's
// own guide says so. Anyone who knows the URL can post to it, so the post proves nothing and is never believed: it only
// NAMES a session. Whether money moved is CardCom's own answer to GetLpResult, asked by settleCardcomSession.
//
// That is what makes the route safe to leave open: a forged post, an unknown id, a repeated post and one that arrives
// before the buyer's own call are all harmless, because the ledger row leaves `pending` exactly once.
//
// What it answers (CardCom retries up to 7 times when it does not get HTTP 200):
//   200  anything CardCom should NOT retry: settled (any outcome, repeats included) and an id we do not know;
//   500  CardCom could not be asked right now — please post again;
//   400 / 413 / 429  a post that is not CardCom's, too large, or from an address that is flooding the route.
//
// Never logged: the body (it carries the buyer's name, phone, e-mail and ID), tokens, credentials. Ids only.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Far above anything CardCom sends (a few KB), far below anything worth parsing.
const MAX_BODY_BYTES = 10_000;
// Per client address. Generous on purpose: CardCom's retries and a busy minute must never be turned away, while a flood
// from one address is. In-memory and per process (see rate-limit.ts): a first line of defence, not an exact quota.
const RATE = { limit: 120, windowMs: 60_000 } as const;

// Only the session id is read. Its format is not documented, so it is bounded, not assumed to be a UUID.
const bodySchema = z.object({ LowProfileId: z.string().min(1).max(64) });

const respond = (status: number, body: Record<string, unknown> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  const ip = getClientIp((name) => request.headers.get(name));
  if (!(await rateLimit(`cardcom-webhook:${ip}`, RATE)).allowed) return respond(429);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return respond(413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return respond(413);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return respond(400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return respond(400);
  const lowProfileId = parsed.data.LowProfileId;

  try {
    // finalizeUnpaid: a webhook comes AFTER the buyer submitted, so a non-zero answer means the payment did not happen.
    const settled = await settleCardcomSession(lowProfileId, { finalizeUnpaid: true });
    if (settled.status === 'error') return respond(500);
    if (settled.status === 'not_found') {
      // CardCom's guide: no order for this id — stop and tell an admin, with the id. Answered 200 so that CardCom does not
      // retry something that will never match. The alert is deduplicated and rate-limited by the alert module.
      void sendSlackAlert({
        level: 'error',
        category: 'campaign_billing',
        source: 'cardcom-webhook',
        title: 'CardCom דיווחה על תשלום שאין לו הזמנה במערכת',
        fields: { low_profile_id: lowProfileId },
      });
    }
    return respond(200, { ok: true });
  } catch {
    // The error text is not echoed: a thrown error can carry a query, a credential or a row.
    console.error('[cardcom-webhook] settling failed unexpectedly', { lowProfileId });
    return respond(500);
  }
}
