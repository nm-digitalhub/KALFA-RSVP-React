import 'server-only';

import type { WebhookInboxInsert } from '@/lib/data/webhooks';

// Turning a verified ElevenLabs delivery into one webhook_inbox row.
//
// Shared by both post-call routes so the two personas cannot drift into
// different dedupe or correlation rules — the difference between them is one
// event_kind, and nothing else.

export const EL_ANALYSIS_RSVP_KIND = 'el_analysis_rsvp';
export const EL_ANALYSIS_SALES_KIND = 'el_analysis_sales';

/**
 * Null when this delivery is not a post-call analysis and should be answered
 * 200 without storing anything.
 *
 * The sales endpoint is bound to FIVE workspace usages (verified live
 * 2026-09-01: ConvAI Agent Settings, ConvAI Alerting, Speech to Text, Flows,
 * Voice Library Removal Notices), so most of what arrives there is not a call
 * at all. Only post_call_transcription carries an analysis; post_call_audio is
 * heavy PII and is deliberately never stored.
 */
export function buildElevenLabsAnalysisRow(
  payload: unknown,
  eventKind: typeof EL_ANALYSIS_RSVP_KIND | typeof EL_ANALYSIS_SALES_KIND,
): WebhookInboxInsert | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const env = payload as Record<string, unknown>;
  if (env.type !== 'post_call_transcription') return null;

  const data = typeof env.data === 'object' && env.data !== null
    ? (env.data as Record<string, unknown>)
    : {};
  const conversationId = typeof data.conversation_id === 'string' ? data.conversation_id : '';
  if (!conversationId) return null;

  // Unix SECONDS. Absent on a hand-made payload; the row is still worth keeping,
  // so it falls back to now() rather than being rejected.
  const eventTs = typeof env.event_timestamp === 'number' ? env.event_timestamp : null;

  return {
    provider: 'elevenlabs',
    // conversation_id ALONE is not the key. "The retry payload is identical to
    // the original delivery attempt" (provider docs), so a retry collapses onto
    // the same key — which is what we want. But a conversation can be RE-ANALYSED
    // and delivered again with a new timestamp, and that is a genuinely
    // different event (observed 2026-09-01: the same conversation graded 87.5
    // with a failed criterion at call time and 100 with all criteria passing
    // hours later). Keying on the pair keeps both; keying on the id alone would
    // silently drop the second.
    dedupe_key: `${conversationId}:${eventTs ?? 'no-ts'}`,
    event_kind: eventKind,
    // "the provider's message identifier we correlate on", as everywhere else in
    // this table. For a conversation that is the conversation_id — the same
    // value sales_call_attempts.el_conversation_id and call_analysis.
    // conversation_id join on.
    message_id: conversationId,
    event_at: eventTs === null ? null : new Date(eventTs * 1000).toISOString(),
    payload: payload as WebhookInboxInsert['payload'],
  };
}
