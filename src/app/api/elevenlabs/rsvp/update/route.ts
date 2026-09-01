import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { verifyElevenLabsWebhook } from '@/lib/security/elevenlabs-webhook';
import {
  buildElevenLabsAnalysisRow,
  EL_ANALYSIS_RSVP_KIND,
} from '@/lib/data/elevenlabs-webhook-intake';
import { insertWebhookEvents } from '@/lib/data/webhooks';
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
// The HMAC is over the WHOLE body, so it must all be read to verify.
//
// 256 KiB fits any post_call_transcription (the largest real one measured
// 2026-09-01 was ~86 KB) and deliberately does NOT fit a post_call_audio
// delivery, which carries the whole recording inline as base64 MP3 and arrives
// `transfer-encoding: chunked` — no Content-Length to reject it on, so the body
// would be materialised in memory before the cap could refuse it.
//
// `audio` was removed from the workspace webhook events on 2026-09-01, so none
// is sent today. Raise this ONLY together with streaming the body straight to
// storage; simply enlarging it buys a multi-megabyte allocation per call for
// something that is then discarded.
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

  // 4. Store the raw delivery and answer. A signed-but-unparseable body, a non
  //    post_call_transcription type (incl. post_call_audio = heavy PII), or a
  //    payload missing its conversation_id all store NOTHING → 200 no-op.
  let row;
  try {
    row = buildElevenLabsAnalysisRow(JSON.parse(raw), EL_ANALYSIS_RSVP_KIND);
  } catch {
    return resp(200, 'ok');
  }
  if (!row) return resp(200, 'ok');

  // 5. Persist-then-process: the worker normalizes and stores the analysis out
  //    of band (elevenlabs-analysis-processing.ts), so a database problem is
  //    retried locally and inspectable at /admin/webhooks instead of being lost.
  //    Idempotent via UNIQUE(provider, dedupe_key) — the provider states a retry
  //    carries a byte-identical payload, which lands on the same key.
  //
  //    The response is 200 either way, per the provider's own integration
  //    guidance ("After validating the signature, the handler should return HTTP
  //    200 promptly"; repeated non-200 can auto-disable the webhook). A failed
  //    insert therefore raises a Slack alert rather than a status code — ids
  //    only, never PII.
  try {
    await insertWebhookEvents([row]);
  } catch {
    void sendSlackAlert({
      level: 'error',
      category: 'errors',
      source: 'elevenlabs-webhook',
      title: 'שמירת אירוע ניתוח שיחת ElevenLabs נכשלה',
      fields: { conversation_id: row.message_id ?? '—' },
    });
  }
  return resp(200, 'ok');
}
