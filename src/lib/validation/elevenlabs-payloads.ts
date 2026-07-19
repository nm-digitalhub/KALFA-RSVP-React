// Pure, IO-free, TOTAL normalizer for the ElevenLabs post-call webhook payload.
// Same policy as vox-payloads.ts: loose parse + a normalizer that reduces the
// UNTRUSTED provider payload to METADATA ONLY. This is a security boundary — the
// raw payload embeds guest PII (transcript turns, guest_name in
// dynamic_variables, and a name-bearing transcript_summary), and NONE of it may
// cross this function. Only non-PII QA/billing signal fields survive.

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export type CallSuccessful = 'success' | 'failure' | 'unknown';
export type CallStatus = 'done' | 'failed' | 'unknown';

// The metadata-only shape that is safe to persist. NO transcript, NO summary, NO
// dynamic_variables, NO evaluation/data-collection results (all PII-bearing).
export interface NormalizedCallAnalysis {
  conversationId: string;
  agentId: string | null;
  callSuccessful: CallSuccessful;
  status: CallStatus;
  overallScore: number | null;
  callDurationSecs: number | null;
  costCredits: number | null;
  terminationReason: string | null;
  analysisAt: string | null; // ISO
}

// A webhook envelope reduced to its type + (only for post_call_transcription with
// a conversation_id) the metadata-only analysis. `analysis` is null for any other
// type or a payload missing its conversation_id, so the route stores nothing.
export interface NormalizedWebhook {
  type: string | null;
  analysis: NormalizedCallAnalysis | null;
}

const TERMINATION_MAX = 120;

function coerceSuccessful(v: unknown): CallSuccessful {
  return v === 'success' || v === 'failure' ? v : 'unknown';
}
function coerceStatus(v: unknown): CallStatus {
  return v === 'done' || v === 'failed' ? v : 'unknown';
}
// Bounded string (keeps this TOTAL — an oversized id can't exceed the DB's
// btree row-size limit and error the upsert). Real ElevenLabs ids are ~24-40 ch.
function capped(v: unknown, max: number): string | null {
  const s = asString(v);
  return s ? s.slice(0, max) : null;
}
// Unix SECONDS → ISO, range-guarded so an out-of-range timestamp yields null
// (not a RangeError from toISOString) — the normalizer stays total.
function unixSecondsToIso(secs: number | null): string | null {
  if (secs === null) return null;
  const ms = secs * 1000;
  if (ms < 0 || ms > 8.64e15) return null; // outside the valid Date range (±8.64e15 ms)
  return new Date(ms).toISOString();
}

export function normalizeCallAnalysisWebhook(raw: unknown): NormalizedWebhook {
  const env = asObject(raw);
  const type = asString(env.type);
  // Only post_call_transcription carries an analysable conversation; everything
  // else (post_call_audio — heavy PII — and unknown/future types) yields no
  // analysis so the caller no-ops.
  if (type !== 'post_call_transcription') return { type, analysis: null };

  const data = asObject(env.data);
  const conversationId = asString(data.conversation_id);
  if (!conversationId) return { type, analysis: null };

  const metadata = asObject(data.metadata);
  const feedback = asObject(metadata.feedback);
  const analysis = asObject(data.analysis);

  const rawReason = asString(metadata.termination_reason);

  return {
    type,
    analysis: {
      conversationId: conversationId.slice(0, 200),
      agentId: capped(data.agent_id, 128),
      callSuccessful: coerceSuccessful(analysis.call_successful),
      status: coerceStatus(data.status),
      overallScore: asNumber(feedback.overall_score),
      callDurationSecs: asNumber(metadata.call_duration_secs),
      costCredits: asNumber(metadata.cost),
      terminationReason: rawReason ? rawReason.slice(0, TERMINATION_MAX) : null,
      analysisAt: unixSecondsToIso(asNumber(env.event_timestamp)), // unix SECONDS
    },
  };
}
