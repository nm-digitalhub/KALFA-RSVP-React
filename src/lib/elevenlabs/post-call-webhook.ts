import 'server-only';

import { NextResponse } from 'next/server';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { buildElevenLabsAnalysisRow } from '@/lib/data/elevenlabs-webhook-intake';
import { insertWebhookEvents } from '@/lib/data/webhooks';
import { NO_STORE_HEADERS } from '@/lib/http/no-store-json';
import { verifyElevenLabsWebhook } from '@/lib/security/elevenlabs-webhook';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';

// Intake of an ElevenLabs post-call webhook (post_call_transcription): verify, persist the raw delivery, answer.
// Shared by the two provider-registered endpoints — /api/elevenlabs/rsvp/update and
// /api/elevenlabs/rsvp-sales-call-dispatch/pcw_id — which are separate workspace webhooks with separate secrets
// and differ only in the values of PostCallWebhookEndpoint.
//
// The order is the security contract and is the same for both: flood guard → size cap → HMAC over the raw bytes →
// store. Nothing of the body is parsed or stored before the signature verifies.

// Sized well ABOVE peak legit completion rate: ElevenLabs delivers from shared IPs, so throttling a genuine
// delivery loses it forever — this only caps unauthenticated junk-flood compute.
const RATE = { limit: 300, windowMs: 60 * 1000 } as const;

// The HMAC is over the WHOLE body, so it must all be read to verify.
//
// 256 KiB fits any post_call_transcription (the largest real one measured 2026-09-01 was ~86 KB) and deliberately
// does NOT fit a post_call_audio delivery, which carries the whole recording inline as base64 MP3 and arrives
// `transfer-encoding: chunked` — no Content-Length to reject it on, so the body would be materialised in memory
// before the cap could refuse it.
//
// `audio` was removed from the workspace webhook events on 2026-09-01, so none is sent today. Raise this ONLY
// together with streaming the body straight to storage; simply enlarging it buys a multi-megabyte allocation per
// call for something that is then discarded.
const MAX_BODY_BYTES = 256 * 1024;

const resp = (status: number, body: string | null = null) =>
  new NextResponse(body, { status, headers: NO_STORE_HEADERS });

export interface PostCallWebhookEndpoint {
  /** Rate-limit bucket prefix; the client IP is appended. */
  rateLimitKey: string;
  /** This webhook's signing secret, read from the environment by the route. Unset = dark (401). */
  secret: string | undefined;
  /** The inbox event kind the worker dispatches on. */
  eventKind: Parameters<typeof buildElevenLabsAnalysisRow>[1];
  /** Slack alert raised when the inbox insert fails. Ids only, never PII. */
  insertFailureAlert: { source: string; title: string };
}

export async function receivePostCallWebhook(
  req: Request,
  endpoint: PostCallWebhookEndpoint,
): Promise<NextResponse> {
  // 1. Coarse flood guard (fail-closed), keyed by client IP.
  const ip = getClientIp(req.headers.get.bind(req.headers));
  if (!(await rateLimit(`${endpoint.rateLimitKey}:${ip}`, RATE)).allowed) return resp(429);

  // 2. Body-size cap: Content-Length hint, then hard cap after read.
  const declaredLen = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) return resp(413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return resp(413);

  // 3. HMAC over the RAW bytes (before JSON.parse). Every failure reason — no_secret (dark) / malformed_header /
  //    expired / bad_signature — collapses to one uniform 401 with an empty body (no oracle, no reason string).
  const verified = await verifyElevenLabsWebhook(
    raw,
    req.headers.get('elevenlabs-signature'),
    endpoint.secret,
  );
  if (!verified.valid) return resp(401);

  // 4. Store the raw delivery and answer. A signed-but-unparseable body, a non post_call_transcription type
  //    (incl. post_call_audio = heavy PII), or a payload missing its conversation_id all store NOTHING → 200 no-op.
  let row;
  try {
    // The SDK already parsed the verified body; a signed body that is not JSON arrives as undefined.
    if (verified.event === undefined) return resp(200, 'ok');
    row = buildElevenLabsAnalysisRow(verified.event, endpoint.eventKind);
  } catch {
    return resp(200, 'ok');
  }
  if (!row) return resp(200, 'ok');

  // 5. Persist-then-process: the worker normalizes and stores the analysis out of band
  //    (elevenlabs-analysis-processing.ts), so a database problem is retried locally and inspectable at
  //    /admin/webhooks instead of being lost. Idempotent via UNIQUE(provider, dedupe_key) — the provider states a
  //    retry carries a byte-identical payload, which lands on the same key.
  //
  //    The response is 200 either way, per the provider's own integration guidance ("After validating the
  //    signature, the handler should return HTTP 200 promptly"; a 4xx is never retried and repeated non-200 can
  //    auto-disable the webhook). A failed insert therefore raises a Slack alert rather than a status code.
  try {
    await insertWebhookEvents([row]);
  } catch {
    void sendSlackAlert({
      level: 'error',
      category: 'errors',
      source: endpoint.insertFailureAlert.source,
      title: endpoint.insertFailureAlert.title,
      fields: { conversation_id: row.message_id ?? '—' },
    });
  }
  return resp(200, 'ok');
}
