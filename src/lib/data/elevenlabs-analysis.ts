import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { TablesInsert } from '@/lib/supabase/types';
import type { NormalizedCallAnalysis } from '@/lib/validation/elevenlabs-payloads';

type CallAnalysisInsert = TablesInsert<'call_analysis'>;

type CallAnalysisLink = {
  callAttemptId?: string | null;
  eventId?: string | null;
  rsvpPersisted?: boolean | null;
};

export function buildCallAnalysisInsert(
  a: NormalizedCallAnalysis,
  link: CallAnalysisLink = {},
): CallAnalysisInsert {
  const callAttemptId = link.callAttemptId ?? null;
  return {
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
    event_id: link.eventId ?? null,
    linked_at: callAttemptId ? new Date().toISOString() : null,
    // QA (bounded / PII-minimized): numeric score, criterion→pass/fail map, and
    // configured data-collection scalar values. Rationale, transcript, summary,
    // audio, and raw dynamic variables never reach this layer.
    el_call_score: a.callSuccessScore,
    el_eval: a.evaluation,
    el_data: a.dataCollection as CallAnalysisInsert['el_data'],
    // Engagement counters derived from the transcript the normalizer discarded.
    agent_turns: a.agentTurns,
    user_turns: a.userTurns,
    // Owner-approved 2026-09-01 for BOTH personas. The summary describes the
    // people on the call; the rest is scalar. voicemail_detected stays NULL
    // when the detector never ran, which is why the turn-count inference is
    // kept as the fallback rather than replaced outright.
    transcript_summary: a.transcriptSummary,
    summary_title: a.summaryTitle,
    voicemail_detected: a.voicemailDetected,
    sentiment_label: a.sentimentLabel,
    frustration_score: a.frustrationScore,
    cost_fiat: a.costFiat,
    // RSVP-only measured cross-check. Sales analysis leaves this null.
    rsvp_persisted: link.rsvpPersisted ?? null,
  };
}

async function upsertCallAnalysis(row: CallAnalysisInsert): Promise<'stored' | 'error'> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('call_analysis')
    .upsert(row, { onConflict: 'provider,conversation_id', ignoreDuplicates: true });
  return error ? 'error' : 'stored';
}

// Persist a metadata-only ElevenLabs call-analysis signal (QA + billing). Written
// by the HMAC-authed webhook route via the service-role client (the request is
// signature-authed, not session-authed). IDEMPOTENT: upsert on the unique
// (provider, conversation_id) with ignoreDuplicates, so a replayed webhook is a
// DB no-op. NEVER stores transcript / summary / guest data — the normalizer
// already dropped all of it; only the typed metadata fields reach here.
export async function storeCallAnalysis(a: NormalizedCallAnalysis): Promise<'stored' | 'error'> {
  try {
    const admin = createAdminClient();

    // Resolve the owning call attempt via EITHER link vector (best-effort): the
    // correlation token (el_correlation_nonce, injected at conversation start)
    // first, then the ElevenLabs conversation_id (el_conversation_id, reported by
    // the bridge scenario via cb). A miss/failure leaves an orphan (call_attempt_id
    // NULL) a linker can backfill later. event_id is copied so owner RLS scopes it.
    let callAttemptId: string | null = null;
    let eventId: string | null = null;
    let guestId: string | null = null;
    let attemptStartedAt: string | null = null;
    try {
      const lookup = async (
        col: 'el_correlation_nonce' | 'el_conversation_id',
        val: string | null,
      ): Promise<{
        id: string;
        event_id: string;
        guest_id: string | null;
        created_at: string | null;
      } | null> => {
        if (!val) return null;
        const { data } = await admin
          .from('call_attempts')
          .select('id, event_id, guest_id, created_at')
          .eq(col, val)
          .maybeSingle();
        return data ?? null;
      };
      const attempt =
        (await lookup('el_correlation_nonce', a.correlationToken)) ??
        (await lookup('el_conversation_id', a.conversationId));
      if (attempt) {
        callAttemptId = attempt.id;
        eventId = attempt.event_id;
        guestId = attempt.guest_id;
        attemptStartedAt = attempt.created_at;
      }
    } catch {
      /* leave orphan — never fail the store on a link lookup */
    }

    // Did the RSVP the agent reported actually land? ElevenLabs criteria only see
    // the transcript, so `rsvp_captured: success` means "the agent sounded like it
    // saved" — not that anything was written. Compare against the guest row.
    //
    // TIMESTAMPS, not values: a guest already 'attending' from an earlier channel
    // would make a value comparison approve a call that wrote nothing.
    //
    // Stays null on any doubt — no reported outcome, no linked guest, or a failed
    // read. null means "not checked", and the column comment says so, because a
    // false negative here would accuse a working call of losing data.
    let rsvpPersisted: boolean | null = null;
    const reportedStatus =
      typeof a.dataCollection?.status === 'string' ? a.dataCollection.status : null;
    if (reportedStatus && guestId && attemptStartedAt) {
      try {
        const { data: guest } = await admin
          .from('guests')
          .select('updated_at')
          .eq('id', guestId)
          .maybeSingle();
        if (guest?.updated_at) {
          rsvpPersisted = Date.parse(guest.updated_at) >= Date.parse(attemptStartedAt);
        }
      } catch {
        /* leave null — unknown, never asserted as fine */
      }
    }

    const row = buildCallAnalysisInsert(a, {
      callAttemptId,
      eventId,
      rsvpPersisted,
    });
    const { error } = await admin
      .from('call_analysis')
      .upsert(row, { onConflict: 'provider,conversation_id', ignoreDuplicates: true });
    return error ? 'error' : 'stored';
  } catch {
    return 'error';
  }
}

// Sales-close calls are not call_attempts/RSVP rows, so do not run the RSVP
// linker or rsvp_persisted check. The CRM links sales_call_attempts to this row
// at read time via sales_call_attempts.el_conversation_id =
// call_analysis.conversation_id. Still idempotent on (provider, conversation_id).
export async function storeSalesCallAnalysis(
  a: NormalizedCallAnalysis,
): Promise<'stored' | 'error'> {
  try {
    return await upsertCallAnalysis(buildCallAnalysisInsert(a));
  } catch {
    return 'error';
  }
}
