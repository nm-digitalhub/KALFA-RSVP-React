import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { verifyElevenLabsWebhook } from '@/lib/security/elevenlabs-webhook';
import { normalizeCallAnalysisWebhook } from '@/lib/validation/elevenlabs-payloads';
import { storeCallAnalysis } from '@/lib/data/elevenlabs-analysis';
import { sendSlackAlert } from '@/lib/alerts/slack';

// POST /api/elevenlabs/rsvp/update
//
// ElevenLabs post-call webhook (post_call_transcription). AuthN is HMAC over the
// raw body (verifyElevenLabsWebhook + env ELEVENLABS_WEBHOOK) — there is no
// per-guest token in the URL, so a signature failure returns a UNIFORM 401 (not
// a dark 404: nothing guest-specific sits behind this fixed, provider-registered
// endpoint). The payload is a QA + billing SIGNAL: we persist METADATA ONLY and
// mutate NOTHING guest-facing (the in-call save_rsvp tool already owns RSVP
// state). Idempotent on conversation_id; a 30-min replay is harmless (no
// mutation, DB no-op). Dark until ELEVENLABS_WEBHOOK is set AND the ElevenLabs
// post_call_webhook_id is wired.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sized well ABOVE peak legit completion rate: ElevenLabs delivers from shared
// IPs and retry is OFF, so throttling a genuine delivery loses it forever — this
// only caps unauthenticated junk-flood compute.
const RATE = { limit: 300, windowMs: 60 * 1000 } as const;
// The HMAC is over the WHOLE body (transcript included), so we must read it all
// to verify even though the transcript is dropped immediately after.
const MAX_BODY_BYTES = 256 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const resp = (status: number, body: string | null = null) =>
  new NextResponse(body, { status, headers: NO_STORE });

export async function POST(req: Request) {
  // 1. Coarse flood guard (fail-closed), keyed by client IP.
  const ip = getClientIp(req.headers.get.bind(req.headers));
  if (!rateLimit(`el-rsvp-update:${ip}`, RATE).allowed) return resp(429);

  // 2. Body-size cap: Content-Length hint, then hard cap after read.
  const declaredLen = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) return resp(413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return resp(413);

  // 3. HMAC over the RAW bytes (before JSON.parse). Every failure reason —
  //    no_secret (dark) / malformed_header / expired / bad_signature — collapses
  //    to one uniform 401 with an empty body (no oracle, no reason string).
  const verified = verifyElevenLabsWebhook(
    raw,
    req.headers.get('elevenlabs-signature'),
    process.env.ELEVENLABS_WEBHOOK,
    Date.now(),
  );
  if (!verified.valid) return resp(401);

  // 4. Normalize to metadata-only. A signed-but-unparseable body, a non
  //    post_call_transcription type (incl. post_call_audio = heavy PII), or a
  //    payload missing its conversation_id all store NOTHING → 200 no-op.
  let parsed;
  try {
    parsed = normalizeCallAnalysisWebhook(JSON.parse(raw));
  } catch {
    return resp(200, 'ok');
  }
  if (parsed.type !== 'post_call_transcription' || !parsed.analysis) return resp(200, 'ok');

  // 5. Persist the metadata-only signal (idempotent upsert). A durable failure is
  //    surfaced (retry is OFF here, so a silent loss has no safety net) — ids
  //    only, never PII.
  const result = await storeCallAnalysis(parsed.analysis);
  if (result === 'error') {
    void sendSlackAlert({
      level: 'error',
      category: 'errors',
      source: 'elevenlabs-webhook',
      title: 'שמירת ניתוח שיחת ElevenLabs נכשלה',
      fields: { conversation_id: parsed.analysis.conversationId },
    });
    return resp(500);
  }
  return resp(200, 'ok');
}
