import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import type { NormalizedCallAnalysis } from '@/lib/validation/elevenlabs-payloads';

type CallAnalysisInsert = Database['public']['Tables']['call_analysis']['Insert'];

// Persist a metadata-only ElevenLabs call-analysis signal (QA + billing). Written
// by the HMAC-authed webhook route via the service-role client (the request is
// signature-authed, not session-authed). IDEMPOTENT: upsert on the unique
// (provider, conversation_id) with ignoreDuplicates, so a replayed webhook is a
// DB no-op. NEVER stores transcript / summary / guest data — the normalizer
// already dropped all of it; only the typed metadata fields reach here.
export async function storeCallAnalysis(a: NormalizedCallAnalysis): Promise<'stored' | 'error'> {
  try {
    const admin = createAdminClient();

    // Resolve the correlation token → the owning call attempt (item 2 link
    // vector: a NON-authorizing nonce injected at conversation start, round-
    // tripped in the webhook). Best-effort — a miss/failure leaves an orphan row
    // (call_attempt_id NULL), which a linker can backfill later via the partial
    // index. event_id is copied from the attempt so owner RLS scopes the row.
    let callAttemptId: string | null = null;
    let eventId: string | null = null;
    if (a.correlationToken) {
      try {
        const { data } = await admin
          .from('call_attempts')
          .select('id, event_id')
          .eq('el_correlation_nonce', a.correlationToken)
          .maybeSingle();
        if (data) {
          callAttemptId = data.id;
          eventId = data.event_id;
        }
      } catch {
        /* leave orphan — never fail the store on a link lookup */
      }
    }

    const row: CallAnalysisInsert = {
      provider: 'elevenlabs',
      conversation_id: a.conversationId,
      agent_id: a.agentId,
      call_successful: a.callSuccessful,
      status: a.status,
      overall_score: a.overallScore,
      call_duration_secs: a.callDurationSecs,
      cost_credits: a.costCredits,
      termination_reason: a.terminationReason,
      analysis_at: a.analysisAt,
      call_attempt_id: callAttemptId,
      event_id: eventId,
      linked_at: callAttemptId ? new Date().toISOString() : null,
    };
    const { error } = await admin
      .from('call_analysis')
      .upsert(row, { onConflict: 'provider,conversation_id', ignoreDuplicates: true });
    return error ? 'error' : 'stored';
  } catch {
    return 'error';
  }
}
