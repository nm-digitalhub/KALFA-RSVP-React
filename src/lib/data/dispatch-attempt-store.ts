import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/types';

// The queries callback_request_attempts and sales_call_attempts share. Both are
// Voximplant token/dispatch-bookkeeping tables for a call on a callback_requests
// row and carry the same dispatch columns; each table's own DAL
// (callback-request-attempts.ts, sales-call-attempts.ts) names its table and
// its error wording and keeps everything that differs (the atomic create, the
// outcome claim, the slot reads). Request-FREE, service-role. Never logs or
// selects access_token: it is only ever a lookup key.

export type DispatchAttemptTable = 'callback_request_attempts' | 'sales_call_attempts';

// Mirrors call_attempts' own PRE_TERMINAL exactly (call-attempts.ts) — the
// dispatch_status CHECK constraint's pre-terminal subset. Used for the
// concurrency count and every CAS-guarded update below.
export const DISPATCH_PRE_TERMINAL = ['queued', 'dialing', 'in_progress'] as const;

type AttemptColumns = Tables<'callback_request_attempts'> & Tables<'sales_call_attempts'>;
export type AttemptTokenRow = Pick<AttemptColumns, 'id' | 'callback_request_id' | 'token_expires_at'>;
export type AttemptVoiceRow = Pick<
  AttemptColumns,
  'id' | 'callback_request_id' | 'token_expires_at' | 'scheduled_at_snapshot' | 'el_conversation_id'
>;

// Record a CONFIRMED StartScenarios start. Does NOT change dispatch_status: the
// row stays pre-terminal until a real terminal signal arrives. Guarded so an
// already-past-pre-terminal row can never be clobbered.
export async function recordAttemptDialConfirmed(
  table: DispatchAttemptTable,
  id: string,
  callSessionHistoryId: number,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .update({
      vox_call_session_history_id: String(callSessionHistoryId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום אימות החיוג נכשל', { cause: error });
  return { applied: data !== null };
}

// A StartScenarios that did not place the call: a definite provider rejection
// (failed_to_start) or an ambiguous outcome (start_unknown). Terminal for THIS
// attempt; only applies from a pre-terminal dispatch_status.
export async function recordAttemptDispatchOutcome(
  table: DispatchAttemptTable,
  id: string,
  status: 'failed_to_start' | 'start_unknown',
  reason: string,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .update({
      dispatch_status: status,
      finish_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום תוצאת השיגור נכשל', { cause: error });
  return { applied: data !== null };
}

// The scenario's OWN terminal lifecycle report: the call session ended, one way
// or another. dispatch_status moves to 'concluded' regardless of WHY the call
// ended, so the row stops consuming a concurrency slot. Only applies from a
// pre-terminal dispatch_status, so a duplicate/late report can never clobber an
// already-concluded row.
export async function recordAttemptDispatchConcluded(
  table: DispatchAttemptTable,
  id: string,
  finishReason: string,
  callDurationSec: number | null,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .update({
      dispatch_status: 'concluded',
      finish_reason: finishReason,
      call_duration_sec: callDurationSec,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[])
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום סיום השיחה נכשל', { cause: error });
  return { applied: data !== null };
}

// ADDITIVE, best-effort (mirrors call-attempts.ts's setElConversationId): the
// scenario's terminal report may carry the ElevenLabs conversation_id captured
// earlier from ConversationInitiationMetadata. Not gated on dispatch_status — a
// late/duplicate report should still be able to fill this in if the earlier
// attempt somehow missed it.
export async function setAttemptElConversationId(
  table: DispatchAttemptTable,
  id: string,
  elConversationId: string,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .update({ el_conversation_id: elConversationId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('רישום מזהה השיחה נכשל', { cause: error });
  return { applied: data !== null };
}

// Durable concurrency counter — one table's half of the combined cross-table
// count. Never call this alone to enforce a concurrency cap; see
// voximplant-concurrency.ts's countActiveCallsAllSurfaces for why.
export async function countActiveDispatchAttempts(
  table: DispatchAttemptTable,
  errorCode: string,
): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in('dispatch_status', DISPATCH_PRE_TERMINAL as unknown as string[]);
  if (error) throw new Error(errorCode);
  return count ?? 0;
}

// cb/tool endpoints: resolve id + expiry from the opaque access_token. Identity
// ALWAYS comes from this server-side lookup — never from the POSTed body.
export async function getAttemptByAccessToken(
  table: DispatchAttemptTable,
  accessToken: string,
  errorMessage: string,
): Promise<AttemptTokenRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .select('id, callback_request_id, token_expires_at')
    .eq('access_token', accessToken)
    .maybeSingle<AttemptTokenRow>();
  if (error) throw new Error(errorMessage, { cause: error });
  return data ?? null;
}

// ctx endpoint, first of its two sequential queries: the attempt behind the
// opaque access_token. Freshness is NOT verified here — that is the ROUTE's
// job, so a null never conflates "no such token" with "found but stale".
export async function getAttemptVoiceRowByAccessToken(
  table: DispatchAttemptTable,
  accessToken: string,
  errorMessage: string,
): Promise<AttemptVoiceRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .select('id, callback_request_id, token_expires_at, scheduled_at_snapshot, el_conversation_id')
    .eq('access_token', accessToken)
    .maybeSingle<AttemptVoiceRow>();
  if (error) throw new Error(errorMessage, { cause: error });
  return data ?? null;
}

// The parent callback_requests row's contact fields for a tool-call processing
// function, which needs full_name/phone/topic — fields the ctx/cb-oriented
// lookups above deliberately don't carry. Two sequential queries, not an
// embedded join (the convention call-attempts.ts's hydrateCallContext set).
export async function getCallbackRequestContactForAttempt(
  table: DispatchAttemptTable,
  attemptId: string,
  errorMessage: string,
): Promise<{
  callbackRequestId: string;
  fullName: string;
  phone: string;
  topic: string | null;
} | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from(table)
    .select('callback_request_id')
    .eq('id', attemptId)
    .maybeSingle<Pick<AttemptColumns, 'callback_request_id'>>();
  if (error) throw new Error(errorMessage, { cause: error });
  if (!attempt) return null;

  const { data: request, error: reqErr } = await admin
    .from('callback_requests')
    .select('full_name, phone, topic')
    .eq('id', attempt.callback_request_id)
    .maybeSingle();
  if (reqErr) throw new Error('טעינת בקשת ההתקשרות נכשלה', { cause: reqErr });
  if (!request) return null;

  return {
    callbackRequestId: attempt.callback_request_id,
    fullName: request.full_name,
    phone: request.phone,
    topic: request.topic,
  };
}
