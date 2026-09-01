import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { verifyElevenLabsWebhook } from '@/lib/security/elevenlabs-webhook';
import {
  buildElevenLabsAnalysisRow,
  EL_ANALYSIS_SALES_KIND,
} from '@/lib/data/elevenlabs-webhook-intake';
import { insertWebhookEvents } from '@/lib/data/webhooks';
import { sendSlackAlert } from '@/lib/alerts/slack';

// POST /api/elevenlabs/rsvp-sales-call-dispatch/pcw_id
//
// ElevenLabs post-call webhook (post_call_transcription), SALES-CLOSE PERSONA
// ONLY — a SEPARATE workspace webhook from the RSVP one at rsvp/update (env
// ELEVENLABS_SALES_WEBHOOK, not ELEVENLABS_WEBHOOK; its own webhook_id in
// ElevenLabs). The "pcw_id" segment is NOT a Next.js dynamic route (no
// brackets) — it is a fixed, literal path component. It cannot be renamed:
// webhook_url is set once at creation and is absent from the workspace
// webhook PATCH schema (verified against /v1/workspace/webhooks/{id} — only
// is_disabled/name/retry_enabled/request_headers/events are editable), so
// this exact path is now permanently bound to a real, already-registered
// ElevenLabs webhook.
//
// PURPOSE: closes a real gap found live 2026-08-31. sales-call-attempts.ts's
// file header documents FOUR outcome-write paths (send_signup_link,
// log_outcome, the sls/cb no-answer report, and — until now — nothing else),
// all gated behind claimSalesOutcome()'s one-shot outcome_recorded_at claim.
// A sales call that telephony-CONNECTED, had a real conversation, and then
// ended (e.g. the caller hung up) WITHOUT the agent ever calling
// send_signup_link or log_outcome hits none of those four paths — the claim
// is never made, outcome_recorded_at stays NULL forever, and
// getUnresolvedSalesAttempt then blocks EVERY subsequent dial to that same
// contact with reason 'prior_call_unresolved' (observed live, repeatedly,
// this session — see callback_request_id 35eab495…). This route is the
// fifth, catch-all path: ElevenLabs's own post-call analysis is the
// authoritative signal that the conversation is fully over, so once it
// arrives, anything still unclaimed is resolved here as 'needs_followup' —
// the same value the agent's own prompt already uses for every other
// non-success, non-terminal case (step 7 / "צריך לחשוב על זה").
//
// Both of those — persisting the analysis and making the catch-all claim — now
// run in the WORKER, off this request (elevenlabs-analysis-processing.ts). This
// route verifies, persists the raw delivery, and answers. Rewritten 2026-09-01;
// it previously did all of it inline and returned 500 to buy a provider retry,
// which the provider's own documentation rules out twice over: a 4xx is never
// retried at all, and "repeated failure to return a success response may result
// in the webhook becoming automatically disabled" — so trading 500s for retries
// risks escalating a passing database fault into a disconnected webhook.
//
// AuthN is the identical HMAC scheme as rsvp/update (verifyElevenLabsWebhook)
// — just a different secret, since this is a different webhook_id. A signature
// failure returns a uniform 401 (no oracle).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same sizing rationale as rsvp/update: ElevenLabs delivers from shared IPs,
// so throttling a genuine delivery loses it forever — this only caps
// unauthenticated junk-flood compute.
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
  if (!rateLimit(`el-sales-outcome:${ip}`, RATE).allowed) return resp(429);

  // 2. Body-size cap: Content-Length hint, then hard cap after read.
  const declaredLen = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) return resp(413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return resp(413);

  // 3. HMAC over the RAW bytes (before JSON.parse). Every failure reason —
  //    no_secret (dark) / malformed_header / expired / bad_signature —
  //    collapses to one uniform 401 with an empty body (no oracle).
  const verified = verifyElevenLabsWebhook(
    raw,
    req.headers.get('elevenlabs-signature'),
    process.env.ELEVENLABS_SALES_WEBHOOK,
    Date.now(),
  );
  if (!verified.valid) return resp(401);

  // 4. Store the raw delivery and answer. A signed-but-unparseable body, a non
  //    post_call_transcription type, or a payload missing its conversation_id
  //    all store NOTHING → 200 no-op. This endpoint is bound to FIVE workspace
  //    usages (ConvAI Agent Settings + Alerting, Speech to Text, Flows, Voice
  //    Library Removal), so unrelated event types are the common case here.
  let row;
  try {
    row = buildElevenLabsAnalysisRow(JSON.parse(raw), EL_ANALYSIS_SALES_KIND);
  } catch {
    return resp(200, 'ok');
  }
  if (!row) return resp(200, 'ok');

  // 5. Persist-then-process. Storing the analysis AND resolving the stuck
  //    attempt (the fifth outcome-write path described above) both moved to
  //    the worker — see elevenlabs-analysis-processing.ts. Failure there is
  //    retried locally and lands in /admin/webhooks with its error, instead of
  //    depending on the provider retrying a delivery it will not retry after a
  //    4xx and will auto-disable the webhook over.
  //
  //    The response is 200 either way, per the provider's integration guidance.
  //    A failed insert raises a Slack alert rather than a status code.
  try {
    await insertWebhookEvents([row]);
  } catch {
    void sendSlackAlert({
      level: 'error',
      category: 'errors',
      source: 'elevenlabs-sales-webhook',
      title: 'שמירת אירוע ניתוח שיחת מכירה נכשלה',
      fields: { conversation_id: row.message_id ?? '—' },
    });
  }
  return resp(200, 'ok');
}
