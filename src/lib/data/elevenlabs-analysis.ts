import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { TablesInsert } from '@/lib/supabase/types';
import type { NormalizedCallAnalysis } from '@/lib/validation/elevenlabs-payloads';

type CallAnalysisInsert = TablesInsert<'call_analysis'>;

type CallAnalysisLink = {
  callAttemptId?: string | null;
  eventId?: string | null;
  rsvpPersisted?: boolean | null;
  /** Which of the five attempt tables `attemptId` points at. */
  attemptTable?: AttemptTable | null;
  /** The owning attempt row, in ANY attempt table. */
  attemptId?: string | null;
};

export function buildCallAnalysisInsert(
  a: NormalizedCallAnalysis,
  link: CallAnalysisLink = {},
): CallAnalysisInsert {
  const callAttemptId = link.callAttemptId ?? null;
  // ⚠️ `linked_at` follows the PAIR, not the foreign key. Four of the five
  // attempt tables can never fill `call_attempt_id` — it is a FK to
  // `call_attempts` — so keying "is this linked" off that column alone would
  // report every Meeting-Confirm, Sales-Close, customer-service and
  // voice-purpose call as an orphan for ever, which is exactly the state this
  // change exists to end.
  const attemptId = link.attemptId ?? callAttemptId;
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
    attempt_table: link.attemptTable ?? (callAttemptId ? 'call_attempts' : null),
    attempt_id: attemptId,
    event_id: link.eventId ?? null,
    linked_at: attemptId ? new Date().toISOString() : null,
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
/**
 * Where each voice agent records its dial attempts.
 *
 * ⚠️ MEASURED 2026-09-14: `call_analysis` held 39 rows and 20 links, and the
 * split was per-agent — KALFA-RSVP 20/24, and Meeting-Confirm, Sales-Close and
 * the customer-service agent 0 of 15 between them. The lookup consulted
 * `call_attempts` and nothing else, so three of the four agents could never
 * link a single call. Every table below carries `el_conversation_id`; only the
 * first was being read.
 *
 * ORDER MATTERS. `call_attempts` is first because it is the only one reachable
 * by BOTH vectors and the only one with a real foreign key on the far side.
 * `voice_purpose_attempts` is last and is the reason this is a list rather than
 * four more `if`s: a purpose added from the admin panel gets linked with no code
 * change at all.
 */
const ATTEMPT_TABLES = [
  { table: 'call_attempts', hasNonce: true, eventCol: 'event_id', guestCol: 'guest_id' },
  { table: 'callback_request_attempts', hasNonce: false, eventCol: null, guestCol: null },
  { table: 'sales_call_attempts', hasNonce: false, eventCol: null, guestCol: null },
  { table: 'inbound_agent_attempts', hasNonce: false, eventCol: 'event_id', guestCol: 'guest_id' },
  { table: 'voice_purpose_attempts', hasNonce: false, eventCol: 'event_id', guestCol: null },
] as const;

export type AttemptTable = (typeof ATTEMPT_TABLES)[number]['table'];

type ResolvedAttempt = {
  table: AttemptTable;
  id: string;
  eventId: string | null;
  guestId: string | null;
  createdAt: string | null;
};

/**
 * The attempt this analysis belongs to, or null.
 *
 * Best-effort by design: a miss leaves an orphan a linker can backfill, and a
 * throw here must never fail the store — the analysis itself is worth keeping
 * even unlinked.
 */
async function resolveAttempt(
  admin: ReturnType<typeof createAdminClient>,
  correlationToken: string | null,
  conversationId: string | null,
): Promise<ResolvedAttempt | null> {
  for (const spec of ATTEMPT_TABLES) {
    // The correlation nonce is injected at conversation start and is the
    // stronger signal, so it is tried first — but only `call_attempts` has it.
    // The correlation value arrives on the ElevenLabs post-call webhook, which
    // is a DIFFERENT sender from the VoxEngine scenario's closing `cb` — so it
    // survives a cb that never lands. Until now only `call_attempts` could use
    // it, because only it has a nonce column; for the other four the token was
    // received and then ignored, leaving `el_conversation_id` (written by that
    // same fragile cb) as the single way in.
    //
    // The other four ctx routes send the attempt's own PRIMARY KEY as the
    // token, so matching it against `id` costs one indexed lookup and needs no
    // schema change. `sales_call_attempts` already did exactly this by hand
    // (getSalesAttemptIdByConversationId, "Voximplant misses the terminal cb");
    // this generalises that one-off to every table, `voice_purpose_attempts`
    // included.
    //
    // The UUID guard is not cosmetic: `.eq('id', <non-uuid>)` raises 22P02, and
    // `call_attempts` sends a nonce here, not a key.
    const isUuid = !!correlationToken && /^[0-9a-f-]{36}$/i.test(correlationToken);
    const vectors: [string, string | null][] = spec.hasNonce
      ? [
          ['el_correlation_nonce', correlationToken],
          ['el_conversation_id', conversationId],
        ]
      : [
          ...(isUuid ? ([['id', correlationToken]] as [string, string | null][]) : []),
          ['el_conversation_id', conversationId],
        ];

    for (const [col, val] of vectors) {
      if (!val) continue;
      const cols = ['id', 'created_at', spec.eventCol, spec.guestCol].filter(Boolean).join(', ');
      const { data } = await admin
        .from(spec.table)
        .select(cols)
        .eq(col, val)
        .maybeSingle<Record<string, string | null>>();
      if (data?.id) {
        return {
          table: spec.table,
          id: data.id,
          eventId: spec.eventCol ? (data[spec.eventCol] ?? null) : null,
          guestId: spec.guestCol ? (data[spec.guestCol] ?? null) : null,
          createdAt: data.created_at ?? null,
        };
      }
    }
  }
  return null;
}

export async function storeCallAnalysis(a: NormalizedCallAnalysis): Promise<'stored' | 'error'> {
  try {
    const admin = createAdminClient();

    // Resolve the owning call attempt via EITHER link vector (best-effort): the
    // correlation token (el_correlation_nonce, injected at conversation start)
    // first, then the ElevenLabs conversation_id (el_conversation_id, reported by
    // the bridge scenario via cb). A miss/failure leaves an orphan (call_attempt_id
    // NULL) a linker can backfill later. event_id is copied so owner RLS scopes it.
    let callAttemptId: string | null = null;
    let attemptTable: AttemptTable | null = null;
    let attemptRowId: string | null = null;
    let eventId: string | null = null;
    let guestId: string | null = null;
    let attemptStartedAt: string | null = null;
    try {
      const found = await resolveAttempt(admin, a.correlationToken, a.conversationId);
      if (found) {
        attemptTable = found.table;
        attemptRowId = found.id;
        eventId = found.eventId;
        guestId = found.guestId;
        attemptStartedAt = found.createdAt;
        // ⚠️ ONLY for `call_attempts`. `call_analysis.call_attempt_id` is a
        // FOREIGN KEY to that table — writing any other table's id into it is a
        // constraint violation, which would make the store FAIL on exactly the
        // calls this lookup was widened to capture. The polymorphic pair above
        // is what carries the other four.
        if (found.table === 'call_attempts') callAttemptId = found.id;
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
      attemptTable,
      attemptId: attemptRowId,
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

// Every persona that is NOT RSVP lands here: sales-close, meeting-confirm, the
// customer-service agent, and any voice purpose. The rsvp_persisted check stays
// out — it compares a guest row against a reported RSVP status and means
// nothing for these calls — but the LINK does not.
//
// ⚠️ MEASURED 2026-09-15 on the live table: 22 of 42 `call_analysis` rows had
// `attempt_id` NULL, and SIX of them arrived after the 2026-09-14 change that
// widened `resolveAttempt` to all five attempt tables. The widening worked; it
// was simply unreachable. `resolveAttempt` is called from `storeCallAnalysis`
// alone, and a meeting-confirm conversation never gets there:
// `isRsvpConversation` consults `call_attempts` only, so it routes to this
// function, which passed `{}` as the link and wrote NULL.
//
// Not a race — checked: the analyses landed 27-71s AFTER the cb wrote
// `el_conversation_id`, so the vector was available and simply never tried.
//
// `buildCallAnalysisInsert`'s own comment says the polymorphic pair exists so
// these four personas stop being orphans for ever; this is the call that makes
// that true. `call_attempt_id` stays reserved for `call_attempts` (it is a FK),
// which `resolveAttempt`'s caller contract already guarantees.
export async function storeSalesCallAnalysis(
  a: NormalizedCallAnalysis,
): Promise<'stored' | 'error'> {
  try {
    const admin = createAdminClient();
    let link: CallAnalysisLink = {};
    try {
      const found = await resolveAttempt(admin, a.correlationToken, a.conversationId);
      if (found) {
        link = {
          attemptTable: found.table,
          attemptId: found.id,
          eventId: found.eventId,
          // FK to call_attempts only — never any other table's id.
          callAttemptId: found.table === 'call_attempts' ? found.id : null,
        };
      }
    } catch {
      /* leave orphan — a link lookup must never fail the store */
    }
    return await upsertCallAnalysis(buildCallAnalysisInsert(a, link));
  } catch {
    return 'error';
  }
}
