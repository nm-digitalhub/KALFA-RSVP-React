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
// guest dynamic_variables, NO evaluation/data-collection results (all PII-bearing).
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
  // OUR injected, NON-authorizing correlation token (link vector for item 2's
  // bridge). It is the ONLY dynamic_variable we read back — every guest-bearing
  // var (guest_name, …) stays dropped. Never persisted as-is: the linker
  // resolves it to a call_attempts FK. Null when absent (e.g. preview sessions).
  correlationToken: string | null;
  // QA analysis — populated once the agent has evaluation/data-collection enabled.
  // ALL PII-safe: a numeric score; a criterion→pass/fail map (the free-text
  // rationale that may name the guest is DROPPED); and a STRUCTURED RSVP read
  // (status/adults/children only — never names/notes) for cross-checking save_rsvp.
  callSuccessScore: number | null;
  evaluation: Record<string, string> | null;
  dataCollection: { status: string | null; adults: number | null; children: number | null } | null;
  // Engagement counters DERIVED from the transcript and then thrown away with it.
  // The provider exposes message_count only on the LIST endpoint, not in this
  // payload — but the transcript is here, so the counts are computed before the
  // PII is dropped. They are plain integers: no text, no roles' content, nothing
  // that could name a guest. `userTurns` is the one that matters — a voicemail
  // produces agent turns and ~zero user turns, which is what separates "a human
  // engaged" from "the agent talked at a machine".
  agentTurns: number;
  userTurns: number;
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

// evaluation_criteria_results: { <id>: { result: 'success'|'failure'|'unknown',
// rationale } } → { <id>: result }. The rationale is free text that may name the
// guest, so it is DROPPED — only the pass/fail verdict survives.
function extractEvaluation(analysis: Record<string, unknown>): Record<string, string> | null {
  const raw = asObject(analysis.evaluation_criteria_results);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const result = asString(asObject(v).result);
    if (result) out[k.slice(0, 64)] = result;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// data_collection_results: { <field>: { value, rationale } } → the STRUCTURED
// value only (rationale DROPPED). Surfaces just the RSVP cross-check fields.
function extractDataCollection(
  analysis: Record<string, unknown>,
): { status: string | null; adults: number | null; children: number | null } | null {
  const raw = asObject(analysis.data_collection_results);
  const value = (field: string): unknown => asObject(raw[field]).value;
  const status = asString(value('rsvp_status'));
  const adults = asNumber(value('adults'));
  const children = asNumber(value('children'));
  if (status === null && adults === null && children === null) return null;
  return { status, adults, children };
}

// Count turns per role WITHOUT retaining a single character of what was said.
// The transcript is the payload's heaviest PII (guest speech verbatim); this
// reduces it to two integers on the way past. Anything that is not an array of
// objects yields 0/0, keeping the normalizer total.
function countTurns(raw: unknown): { agentTurns: number; userTurns: number } {
  if (!Array.isArray(raw)) return { agentTurns: 0, userTurns: 0 };
  let agentTurns = 0;
  let userTurns = 0;
  for (const entry of raw) {
    const role = asString(asObject(entry).role);
    if (role === 'agent') agentTurns += 1;
    else if (role === 'user') userTurns += 1;
  }
  return { agentTurns, userTurns };
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

  // Read back ONLY our own correlation token from the initiation data — never the
  // sibling guest vars (guest_name, event_name, …), which stay dropped.
  const initVars = asObject(asObject(data.conversation_initiation_client_data).dynamic_variables);

  const rawReason = asString(metadata.termination_reason);
  const turns = countTurns(data.transcript);

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
      correlationToken: capped(initVars.kalfa_attempt_token, 128),
      callSuccessScore: asNumber(analysis.call_success_score),
      evaluation: extractEvaluation(analysis),
      dataCollection: extractDataCollection(analysis),
      agentTurns: turns.agentTurns,
      userTurns: turns.userTurns,
    },
  };
}
