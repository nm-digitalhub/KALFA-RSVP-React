import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { countActiveCalls } from '@/lib/data/call-attempts';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for AI-call counts (owner-agent tool 4,
// voice_calls_summary; plan §5). Takes a service-role client and returns
// numbers only. The /admin/voice summary tiles (voice-ops.ts
// getVoiceDashboardSummary) call this core for their 7-day numbers, so the
// page and the agent cannot disagree. Authorization is the caller's:
// manage_voice, checked by voice-ops.ts and by the owner agent's server-side
// permission resolution (plan §3.2).
//
// No imports of the DAL or of request-scoped Next APIs (enforced by the
// `owner-agent-request-free` rule in .dependency-cruiser.cjs). call-attempts.ts
// is itself the request-free call DAL the worker uses.
//
// Privacy: head-only counts. access_token, transcript and recording_url are
// never selected.
//
// Errors THROW: without that a DB error reads as count 0 and the owner gets a
// confident wrong number (the same contract the /admin/voice tiles always had).

type AdminClient = ReturnType<typeof createAdminClient>;

// The answer-rate denominator (voice-ops plan §4, binding): terminal outcomes
// only; cancelled is excluded (the attempt never reached the callee), and the
// non-terminal failed_to_start/start_unknown markers are excluded too.
export const ANSWER_RATE_DENOM = ['completed', 'no_answer', 'no_response', 'failed'] as const;

// Answer-rate formula (plan §4, binding): completed / (completed + no_answer +
// no_response + failed). null ('—' on the page) when the denominator is 0.
export function computeAnswerRate(completed: number, denominator: number): number | null {
  return denominator > 0 ? completed / denominator : null;
}

// Attempts created at or after `sinceIso`. Exported for the /admin/voice
// "today" tile, which keeps its own (UTC-midnight) cut-off — see voice-ops.ts.
export async function countCallAttemptsSince(
  client: AdminClient,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await client
    .from('call_attempts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceIso);
  if (error) throw new Error('count_attempts_failed');
  return count ?? 0;
}

export interface VoiceCallsSummary {
  // Current state (not range-bound): calls in a pre-terminal status now.
  activeNow: number;
  // Within the range.
  attempts: number;
  completed: number;
  answerRate: number | null; // 0–1; null when no terminal outcome in range
}

export async function getVoiceCallsSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<VoiceCallsSummary> {
  const sinceIso = rangeStartIso(range, nowMs);
  // Explicit head-counts, one complete chain each — no builder indirection, so
  // the generated types check every filter.
  const [activeNow, attempts, completed, denom] = await Promise.all([
    countActiveCalls(client),
    countCallAttemptsSince(client, sinceIso),
    client
      .from('call_attempts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso)
      .eq('status', 'completed'),
    client
      .from('call_attempts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso)
      .in('status', [...ANSWER_RATE_DENOM]),
  ]);
  if (completed.error) throw new Error('count_completed_failed');
  if (denom.error) throw new Error('count_answer_denom_failed');

  return {
    activeNow,
    attempts,
    completed: completed.count ?? 0,
    answerRate: computeAnswerRate(completed.count ?? 0, denom.count ?? 0),
  };
}
