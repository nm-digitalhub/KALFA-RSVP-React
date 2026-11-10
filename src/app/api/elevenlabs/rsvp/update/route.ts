import { EL_ANALYSIS_RSVP_KIND } from '@/lib/data/elevenlabs-webhook-intake';
import { receivePostCallWebhook } from '@/lib/elevenlabs/post-call-webhook';

// POST /api/elevenlabs/rsvp/update
//
// ElevenLabs post-call webhook (post_call_transcription). AuthN is HMAC over the
// raw body (verifyElevenLabsWebhook + env ELEVENLABS_WEBHOOK) — there is no
// per-guest token in the URL, so a signature failure returns a UNIFORM 401 (not
// a dark 404: nothing guest-specific sits behind this fixed, provider-registered
// endpoint). The payload is a QA + billing SIGNAL: the raw delivery goes to the
// webhook inbox and the worker keeps METADATA ONLY from it (no transcript turns),
// and nothing guest-facing is mutated (the in-call save_rsvp tool already owns
// RSVP state). Idempotent: the inbox row is keyed on conversation_id +
// event_timestamp and the analysis store upserts on (provider, conversation_id);
// a 30-min replay is harmless (no mutation, DB no-op). Dark until
// ELEVENLABS_WEBHOOK is set AND the ElevenLabs post_call_webhook_id is wired.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return receivePostCallWebhook(req, {
    rateLimitKey: 'el-rsvp-update',
    secret: process.env.ELEVENLABS_WEBHOOK,
    eventKind: EL_ANALYSIS_RSVP_KIND,
    insertFailureAlert: { source: 'elevenlabs-webhook', title: 'שמירת אירוע ניתוח שיחת ElevenLabs נכשלה' },
  });
}
