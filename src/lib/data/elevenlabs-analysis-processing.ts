import 'server-only';

import type { Tables } from '@/lib/supabase/types';
import { normalizeCallAnalysisWebhook } from '@/lib/validation/elevenlabs-payloads';
import { storeCallAnalysis, storeSalesCallAnalysis } from '@/lib/data/elevenlabs-analysis';
import {
  getSalesAttemptIdByConversationId,
  claimSalesOutcome,
} from '@/lib/data/sales-call-attempts';
import { applyCallOutcome } from '@/lib/data/callback-scheduling';

type WebhookInboxRow = Tables<'webhook_inbox'>;

// Post-call analysis processing, moved OFF the HTTP request (2026-09-01).
//
// WHY IT MOVED. The routes used to normalize and persist inline and return 500
// on failure, leaning on ElevenLabs' own retry. Two things make that the wrong
// shape, both from the provider's own documentation:
//
//   1. Retry covers 5xx/429/timeout ONLY. A 4xx is never retried, and neither
//      is anything at all on the RSVP webhook, where retry is switched off
//      (verified live 2026-09-01: retry_enabled false on rsvp/update, true on
//      the sales endpoint). A single bad moment lost the payload for good —
//      which is exactly what happened to nine sales calls before the secret
//      was corrected.
//   2. "Repeated failure to return a success response may result in the webhook
//      becoming automatically disabled." Returning 500 to buy a retry therefore
//      escalates a passing database problem into a DISCONNECTED webhook, in
//      silence.
//
// Persisting the raw payload first and processing it here inverts both: the
// route does one cheap insert and answers 200, and every failure after that is
// OURS to retry — five local attempts, then the row waits in /admin/webhooks
// with its error and a Reprocess button, instead of being gone.
//
// IDEMPOTENT, as the provider requires: a retry carries a byte-identical
// payload, so UNIQUE(provider, dedupe_key) collapses it at the door, and
// storeCallAnalysis/storeSalesCallAnalysis upsert on (provider,
// conversation_id) with ignoreDuplicates besides. Reprocessing the same row by
// hand is a no-op too.

async function normalized(row: WebhookInboxRow) {
  const parsed = normalizeCallAnalysisWebhook(row.payload);
  // The route only ever inserts post_call_transcription rows, so a miss here
  // means a malformed or hand-edited payload — nothing to do, and a throw would
  // just burn the retry budget on something no retry can fix.
  return parsed.type === 'post_call_transcription' ? parsed.analysis : null;
}

/** RSVP persona (/api/elevenlabs/rsvp/update). Metadata + summary; no mutation. */
export async function processElevenLabsRsvpAnalysisRow(row: WebhookInboxRow): Promise<void> {
  const analysis = await normalized(row);
  if (!analysis) return;
  if ((await storeCallAnalysis(analysis)) === 'error') {
    // Throw so the worker records the attempt and retries — the whole point of
    // moving off the request. Never include the payload: it names people.
    throw new Error(`storeCallAnalysis failed for ${analysis.conversationId}`);
  }
}

/**
 * Sales persona (/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id).
 *
 * Also the FIFTH and catch-all outcome-write path (see sales-call-attempts.ts's
 * file header): a call that connected, talked, and ended without the agent ever
 * calling send_signup_link or log_outcome claims none of the other four, so
 * outcome_recorded_at stays NULL forever and getUnresolvedSalesAttempt then
 * blocks every future dial to that contact. ElevenLabs' own post-call analysis
 * is the authoritative "this conversation is over" signal, so anything still
 * unclaimed when it lands resolves here as 'needs_followup'.
 */
export async function processElevenLabsSalesAnalysisRow(row: WebhookInboxRow): Promise<void> {
  const analysis = await normalized(row);
  if (!analysis) return;

  // Analysis first: if this write fails the row is retried, and the one-shot
  // claim below stays untaken so the retry can still make it.
  if ((await storeSalesCallAnalysis(analysis)) === 'error') {
    throw new Error(`storeSalesCallAnalysis failed for ${analysis.conversationId}`);
  }

  // A conversation belonging to another persona simply matches no attempt —
  // the ordinary case, not an error. An already-resolved attempt is caught by
  // claimSalesOutcome's own atomic claim.
  const attempt = await getSalesAttemptIdByConversationId(analysis.conversationId);
  if (!attempt) return;
  const claimed = await claimSalesOutcome(attempt.id);
  if (claimed) await applyCallOutcome(claimed.callbackRequestId, 'needs_followup');
}
