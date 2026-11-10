import { EL_ANALYSIS_SALES_KIND } from '@/lib/data/elevenlabs-webhook-intake';
import { receivePostCallWebhook } from '@/lib/elevenlabs/post-call-webhook';

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
// PURPOSE: the catch-all outcome path for a sales call. sales-call-dispatch.ts's
// file header documents FOUR outcome-write paths (the sls/cb no-answer report,
// sls/tool/signup-link, sls/tool/log-outcome, and this webhook's post-call
// analysis), all gated behind claimSalesOutcome()'s one-shot
// outcome_recorded_at claim.
// A sales call that telephony-CONNECTED, had a real conversation, and then
// ended (e.g. the caller hung up) WITHOUT the agent ever calling
// send_signup_link or log_outcome hits none of the other paths — the claim
// is never made, outcome_recorded_at stays NULL forever, and
// getUnresolvedSalesAttempt then blocks EVERY subsequent dial to that same
// contact with reason 'prior_call_unresolved'. This webhook is the
// catch-all path: ElevenLabs's own post-call analysis is the
// authoritative signal that the conversation is fully over, so once it
// arrives, anything still unclaimed is resolved as 'needs_followup' —
// the same value the agent's own prompt already uses for every other
// non-success, non-terminal case (step 7 / "צריך לחשוב על זה").
//
// Both of those — persisting the analysis and making the catch-all claim —
// run in the WORKER, off this request (elevenlabs-analysis-processing.ts). This
// route verifies, persists the raw delivery, and answers. It never returns 500
// to buy a provider retry, which the provider's own documentation rules out
// twice over: a 4xx is never retried at all, and "repeated failure to return a
// success response may result in the webhook becoming automatically disabled" —
// so trading 500s for retries risks escalating a passing database fault into a
// disconnected webhook.
//
// AuthN is the identical HMAC scheme as rsvp/update (verifyElevenLabsWebhook)
// — just a different secret, since this is a different webhook_id. A signature
// failure returns a uniform 401 (no oracle).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  // This endpoint is bound to FIVE workspace usages (ConvAI Agent Settings + Alerting, Speech to Text, Flows,
  // Voice Library Removal), so unrelated event types — answered 200 and not stored — are the common case here.
  // A stored delivery resolves the stuck attempt (the catch-all outcome-write path described above) in the
  // worker, never on this request.
  return receivePostCallWebhook(req, {
    rateLimitKey: 'el-sales-outcome',
    secret: process.env.ELEVENLABS_SALES_WEBHOOK,
    eventKind: EL_ANALYSIS_SALES_KIND,
    insertFailureAlert: { source: 'elevenlabs-sales-webhook', title: 'שמירת אירוע ניתוח שיחת מכירה נכשלה' },
  });
}
