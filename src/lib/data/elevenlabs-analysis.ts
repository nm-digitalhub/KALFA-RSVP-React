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
    };
    const { error } = await admin
      .from('call_analysis')
      .upsert(row, { onConflict: 'provider,conversation_id', ignoreDuplicates: true });
    return error ? 'error' : 'stored';
  } catch {
    return 'error';
  }
}
