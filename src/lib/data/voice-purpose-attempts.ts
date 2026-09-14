import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Reads and terminal writes for `voice_purpose_attempts` — the row a
// registry-driven voice call creates.
//
// Separate from voice-purpose-dispatch.ts on purpose: that module OPENS an
// attempt (and owns every gate that decides whether a call may be placed at
// all), this one CLOSES it from the scenario's own report. Keeping the close-out
// here is what lets the cb route stay a thin boundary, and mirrors how
// callback-request-attempts.ts and sales-call-attempts.ts are split from their
// dispatchers.

/**
 * Statuses a call may still move OUT of.
 *
 *   pending   — the dispatcher is mid-flight
 *   confirmed — StartScenarios accepted; the call is running
 *
 * `failed` and `unknown` are the dispatcher's own terminal verdicts and are
 * deliberately NOT here: a scenario reporting an outcome for a dispatch that
 * never succeeded would be reporting about a call that was never placed, and
 * overwriting that verdict would erase the more accurate one.
 */
export const PURPOSE_PRE_TERMINAL = ['pending', 'confirmed'] as const;

/**
 * Resolve an attempt by its opaque per-call token. Shaped for
 * `guardTokenGatedToolRequest`, which needs `id` and `token_expires_at`;
 * `run_id` and `node_id` come along because the workflow wake-up (0ב) reads
 * them from the same row the guard already fetched.
 */
export async function getVoicePurposeAttemptByAccessToken(
  accessToken: string,
): Promise<{
  id: string;
  token_expires_at: string;
  run_id: string | null;
  node_id: string | null;
} | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('voice_purpose_attempts')
    .select('id, token_expires_at, run_id, node_id')
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw new Error('טעינת ניסיון השיחה נכשלה');
  return data ?? null;
}

/**
 * Record the scenario's terminal report.
 *
 * `applied` is false when the row had already left the pre-terminal set — a
 * duplicate report, or a dispatch that had already failed. The caller answers
 * 200 either way: a scenario retrying its callback must not be told something
 * went wrong, and the first report is the one that counts.
 */
export async function recordVoicePurposeConcluded(
  id: string,
  finishReason: string,
  callDurationSec: number | null,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('voice_purpose_attempts')
    .update({
      dispatch_status: 'concluded',
      finish_reason: finishReason,
      call_duration_sec: callDurationSec,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('dispatch_status', PURPOSE_PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום סיום השיחה נכשל');
  return { applied: data !== null };
}

/**
 * The ElevenLabs conversation id, when the scenario surfaces one. Additive and
 * best-effort, exactly as on the other two surfaces: it is diagnostic, and
 * losing it must never cost the terminal status that was already recorded.
 */
export async function setVoicePurposeElConversationId(
  id: string,
  elConversationId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('voice_purpose_attempts')
    .update({ el_conversation_id: elConversationId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error('רישום מזהה השיחה נכשל');
}
