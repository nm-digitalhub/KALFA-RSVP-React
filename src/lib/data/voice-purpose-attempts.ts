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
 *   unknown   — StartScenarios gave an answer we could not classify
 *
 * ⚠️ `unknown` BELONGS HERE, and leaving it out was a real bug. It is written
 * when `StartScenarios` returned something unclassifiable or the network failed
 * mid-start — the call may well be ringing, and its scenario holds a VALID
 * token, so a callback can and does arrive. With `unknown` excluded this UPDATE
 * matched zero rows, `applied` came back false, the row stayed `unknown`, and a
 * workflow waiting on that call woke to read `concluded: false` for a call that
 * had in fact completed and reported. That is the exact opposite of what
 * `PURPOSE_SETTLED` says about the same status: it deliberately omits `unknown`
 * BECAUSE a report may still arrive. The two lists have to agree, and they now
 * do — `unknown` is not settled, therefore it is still pre-terminal.
 *
 * `failed` is the one dispatcher verdict that is genuinely terminal: no call was
 * placed, so nothing can report on it, and overwriting it would erase the more
 * accurate answer.
 */
export const PURPOSE_PRE_TERMINAL = ['pending', 'confirmed', 'unknown'] as const;

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
  /**
   * ⚠️ THE SCENARIO'S OWN VERDICT, AND A SEPARATE ARGUMENT ON PURPOSE.
   *
   * The callback carries two independent facts — a normalized `call_status` and
   * a free-text `error_reason` — and this function used to receive only the
   * `error_reason ?? call_status` collapse of them. Whenever the scenario sent
   * both, which it does on every failure path it has, the normalized verdict was
   * discarded and `toBusinessOutcome` was left guessing from an error string it
   * had never seen. Its `default` is `completed`, so a call that failed before it
   * reached anyone was reported to the workflow as a success.
   *
   * Optional because rows written before 2026-09-15 have no such column, and the
   * mapping still falls back to `finish_reason` for them.
   */
  callStatus?: string | null,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('voice_purpose_attempts')
    .update({
      dispatch_status: 'concluded',
      finish_reason: finishReason,
      call_duration_sec: callDurationSec,
      ...(callStatus ? { call_status: callStatus } : {}),
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

/**
 * Statuses that mean the attempt will never report anything further.
 *
 * `unknown` is deliberately NOT here. It is written when `StartScenarios` gave
 * an answer we could not classify — the call may well be ringing, and its
 * scenario still holds a valid token, so a report can still arrive. Treating it
 * as finished would throw away exactly the outcome a waiting step wants most.
 */
export const PURPOSE_SETTLED = ['concluded', 'failed'] as const;

/**
 * The outcome of the call a workflow step placed, read back by run and node.
 *
 * ⚠️ THE WAITING STEP READS THIS; IT NEVER TRUSTS HAVING BEEN WOKEN. A parked run
 * is delivered by whichever comes first — the early wake, the `resume_at`
 * ceiling, or the recovery sweep — and only the first of those implies anything
 * happened. Reading the row makes all three paths produce the same answer, and
 * it is what lets the ceiling fire honestly on a call that never reported.
 *
 * Keyed on (run_id, node_id) because `voice_purpose_attempts_step_uidx` is
 * unique on (run_id, node_id, contact_id) and a run carries one contact, so the
 * pair identifies one row. Ordered and limited anyway: if that ever stops
 * holding, the newest attempt is the one this replay is about, and a silent
 * `maybeSingle()` error would be a step that fails for a reason no one can see.
 */
export async function getVoicePurposeOutcomeForStep(input: {
  runId: string;
  nodeId: string;
}): Promise<{
  attemptId: string;
  dispatchStatus: string;
  finishReason: string | null;
  callStatus: string | null;
  callDurationSec: number | null;
} | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('voice_purpose_attempts')
    .select('id, dispatch_status, finish_reason, call_status, call_duration_sec')
    .eq('run_id', input.runId)
    .eq('node_id', input.nodeId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error('טעינת תוצאת השיחה נכשלה');

  const row = data?.[0];
  return row
    ? {
        attemptId: row.id,
        dispatchStatus: row.dispatch_status,
        finishReason: row.finish_reason,
        callStatus: row.call_status,
        callDurationSec: row.call_duration_sec,
      }
    : null;
}
