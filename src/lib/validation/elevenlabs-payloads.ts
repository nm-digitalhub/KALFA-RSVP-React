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
export type DataCollectionValue = string | number | boolean | null;
export type DataCollection = Record<string, DataCollectionValue>;

// The shape that is safe to persist. NO transcript turns, NO guest
// dynamic_variables, NO free-text rationales.
//
// It DOES now carry ElevenLabs' own written summary (owner-approved 2026-09-01,
// for both personas). A summary is not a transcript — no turns, no quoted
// speech — but it does describe the people on the call, so it is the one field
// here that is not pure metadata. Everything else stays scalar.
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
  // Keep only criterion→pass/fail and configured data-collection VALUES. Drop
  // every free-text rationale. RSVP's historical rsvp_status field is normalized
  // to status for its persistence cross-check; sales fields keep their configured
  // keys (call_outcome/event_type/estimated_guest_count/whatsapp_consent/
  // objection_reason).
  callSuccessScore: number | null;
  evaluation: Record<string, string> | null;
  dataCollection: DataCollection | null;
  // Engagement counters DERIVED from the transcript and then thrown away with it.
  // The provider exposes message_count only on the LIST endpoint, not in this
  // payload — but the transcript is here, so the counts are computed before the
  // PII is dropped. They are plain integers: no text, no roles' content, nothing
  // that could name a guest. `userTurns` is the one that matters — a voicemail
  // produces agent turns and ~zero user turns, which is what separates "a human
  // engaged" from "the agent talked at a machine".
  agentTurns: number;
  userTurns: number;
  // ElevenLabs' written account of the call, and its short title. The most
  // useful thing on a CRM screen and the only free text kept: the rationales
  // attached to every evaluation criterion are still dropped.
  transcriptSummary: string | null;
  summaryTitle: string | null;
  // The provider's OWN voicemail verdict, from metadata.features_usage. Two
  // distinct facts, so it cannot be a single boolean: the detector may not have
  // run at all (enabled=false → null here), which is not the same as "no
  // voicemail". Only `enabled && !used` is a real negative. Replaces the
  // turn-count inference in data/admin/callbacks.ts, which reads a person who
  // answered and stayed silent exactly like an answering machine.
  voicemailDetected: boolean | null;
  // sentiment_analysis. Absent on short calls, hence nullable throughout.
  sentimentLabel: string | null;
  frustrationScore: number | null;
  // metadata.cost_fiat — real money, beside costCredits' provider-internal unit.
  costFiat: number | null;
}

// A webhook envelope reduced to its type + (only for post_call_transcription with
// a conversation_id) the metadata-only analysis. `analysis` is null for any other
// type or a payload missing its conversation_id, so the route stores nothing.
export interface NormalizedWebhook {
  type: string | null;
  analysis: NormalizedCallAnalysis | null;
}

const TERMINATION_MAX = 120;
// Generous but bounded: the observed summary runs ~700 characters and a longer
// call produces a longer one, while an unbounded provider string must never
// decide how big our row is.
const SUMMARY_MAX = 4000;
const SUMMARY_TITLE_MAX = 200;
const SENTIMENT_LABELS = new Set(['positive', 'neutral', 'negative']);
const DATA_COLLECTION_FIELDS = new Set([
  'rsvp_status',
  'adults',
  'children',
  'call_outcome',
  'event_type',
  'estimated_guest_count',
  'whatsapp_consent',
  'objection_reason',
]);

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

function asBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

function scalarValue(field: string, v: unknown): DataCollectionValue {
  if (field === 'adults' || field === 'children' || field === 'estimated_guest_count') {
    return asNumber(v);
  }
  if (field === 'whatsapp_consent') {
    return asBoolean(v);
  }
  const s = asString(v);
  return s ? s.slice(0, 300) : null;
}

// data_collection_results: { <field>: { value, rationale } } → configured
// scalar values only. The rationale is free text that may name the customer, so
// it is DROPPED. Keep the value under its configured key, except the legacy RSVP
// rsvp_status → status alias required by rsvp_persisted.
function extractDataCollection(analysis: Record<string, unknown>): DataCollection | null {
  const raw = asObject(analysis.data_collection_results);
  const out: DataCollection = {};
  for (const [rawField, entry] of Object.entries(raw)) {
    if (!DATA_COLLECTION_FIELDS.has(rawField)) continue;
    const field = rawField === 'rsvp_status' ? 'status' : rawField.slice(0, 64);
    const value = scalarValue(field, asObject(entry).value);
    if (value !== null) out[field] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Count turns per role WITHOUT retaining a single character of what was said.
// The transcript is the payload's heaviest PII (guest speech verbatim); this
// reduces it to two integers on the way past. Anything that is not an array of
// objects yields 0/0, keeping the normalizer total.
// features_usage.voicemail_detection: {enabled, used}. `used` alone is
// meaningless — false means "no voicemail" only when the detector was actually
// on. A disabled detector yields null so the caller falls back to inference
// rather than recording a negative nobody established.
function voicemailVerdict(metadata: Record<string, unknown>): boolean | null {
  const vm = asObject(asObject(metadata.features_usage).voicemail_detection);
  if (vm.enabled !== true) return null;
  return vm.used === true;
}

// Anything outside the closed vocabulary is dropped rather than stored: the DB
// CHECK would reject it anyway, and losing a label beats failing the whole
// write over a value the provider added.
function coerceSentiment(raw: unknown): string | null {
  const value = asString(raw);
  return value && SENTIMENT_LABELS.has(value) ? value : null;
}

// The column's CHECK is 0..1. A provider value outside it is clamped rather
// than rejected — the score is a display signal, never worth losing the row.
function clamp01(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(1, Math.max(0, value));
}

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
      transcriptSummary: capped(analysis.transcript_summary, SUMMARY_MAX),
      summaryTitle: capped(analysis.call_summary_title, SUMMARY_TITLE_MAX),
      voicemailDetected: voicemailVerdict(metadata),
      sentimentLabel: coerceSentiment(asObject(analysis.sentiment_analysis).overall_label),
      frustrationScore: clamp01(
        asNumber(asObject(analysis.sentiment_analysis).overall_frustration_score),
      ),
      costFiat: asNumber(metadata.cost_fiat),
    },
  };
}
