import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import { getVoximplantCallbackSecret } from '@/lib/data/voximplant-config';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import type { Database } from '@/lib/supabase/types';
import { verifyCallToken } from '@/lib/voximplant/call-token';
import { voxCallbackSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/cb/{token}
//
// The Voximplant RSVP scenario POSTs call results here (recording_started, then a
// terminal status). Voximplant sends NO signature header and never retries — it
// only logs the response code — so auth is the signed, purpose='cb', per-call
// token in the path (verified constant-time). PERSIST-THEN-PROCESS: this route
// only VERIFIES + PERSISTS (idempotent, into webhook_inbox) and returns fast; the
// existing 1-minute webhook drain (processWebhookEvent → processCallResult) does
// the RSVP/billing with received/processed/failed states + retry, so a processing
// failure never loses the callback. Mirrors src/app/api/webhooks/whatsapp/route.ts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CB_RATE = { limit: 30, windowMs: 5 * 60 * 1000 } as const;
const MAX_BODY_BYTES = 256 * 1024; // reject anything larger than a real transcript needs

type WebhookInboxInsert = Database['public']['Tables']['webhook_inbox']['Insert'];
type Json = WebhookInboxInsert['payload'];

function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

const bad = (status: number) => new NextResponse(null, { status });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Rate limit FAIL-CLOSED (requirement H): a limiter trip rejects the callback.
  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`vox-cb:${fp}:${ip}`, CB_RATE).allowed) return bad(429);

  // Reject oversized bodies before reading (Content-Length hint), then hard-cap.
  const declaredLen = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) return bad(413);

  const secret = await getVoximplantCallbackSecret();
  const verified = verifyCallToken(secret, token, 'cb', Math.floor(Date.now() / 1000));
  if (!verified.ok) return bad(404);
  const attemptId = verified.callAttemptId;

  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return bad(413);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad(400);
  }

  // strictObject rejects any field outside the verified contract.
  const parsed = voxCallbackSchema.safeParse(json);
  if (!parsed.success) return bad(400);
  const body = parsed.data;

  // invitation_id (if present) MUST match the token's attempt id — it is a
  // sanity check, never the identity source. A mismatch = tampering → reject.
  if (typeof body.invitation_id === 'string' && body.invitation_id !== attemptId) {
    return bad(400);
  }

  // Persist idempotently: UNIQUE(provider, dedupe_key) makes a re-delivered
  // (attempt, status) callback a no-op. message_id carries the TOKEN-verified
  // attempt id — the drain resolves identity from this, never from the payload.
  try {
    const row: WebhookInboxInsert = {
      provider: 'voximplant',
      event_kind: 'call_result',
      dedupe_key: `vox-cb:${attemptId}:${body.call_status}`,
      message_id: attemptId,
      event_at: new Date().toISOString(),
      payload: body as unknown as Json,
    };
    await insertWebhookEvents([row]);
  } catch {
    // Persist failed — return 500 (Voximplant only logs it; we did not lose a
    // stored callback because nothing was stored). Never leak DB detail.
    return bad(500);
  }

  // Stable, minimal ack. Processing + RSVP/billing happen in the webhook drain.
  return new NextResponse('ok', { status: 200 });
}
