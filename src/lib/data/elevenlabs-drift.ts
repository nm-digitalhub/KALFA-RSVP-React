import 'server-only';

// ElevenLabs agent config-drift comparison (plan item 4). PURE canonicalization
// + comparison — the load-bearing correctness of drift detection. The IO wrapper
// (fetch live agent + read the IaC file + Slack/dashboard) is Stage C and will
// consume these; kept in a dedicated file per the one-concern-per-file pattern
// (voximplant-balance / voximplant-reconcile).
//
// WHY canonicalization is required (verified live 2026-07-19): the ElevenLabs
// API server NORMALIZES an agent on read in ways the on-disk IaC file does not,
// so a naive deep-equal or a tools[].name compare yields FALSE-POSITIVE drift:
//   - the built-in `end_call` tool is flattened into `conversation_config.agent.
//     prompt.tools[]` on the live read, but the file keeps it under
//     `...prompt.built_in_tools.end_call` → live shows 4 tool names, file 3;
//   - `tool_ids` arrive in a different ORDER than the file stores them;
//   - the live response carries top-level keys absent from the file (agent_id,
//     metadata, version_id, phone_numbers, whatsapp_accounts, access_info,
//     branch_id, main_branch_id, procedures, trust_context).
// So we reduce BOTH sides to the SAME canonical semantic subset and compare
// sorted(tool_ids) — never tools[].name.

export interface AgentCanonical {
  name: string | null;
  language: string | null;
  firstMessage: string | null;
  prompt: string | null;
  llm: string | null;
  temperature: number | null;
  voiceId: string | null;
  modelId: string | null;
  toolIds: string[]; // sorted; `end_call` is a built-in and never appears here
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// Reduce a live agent response OR an on-disk IaC config (identical shape) to the
// canonical semantic subset. Total + IO-free: any input → a typed value.
export function canonicalizeAgent(raw: unknown): AgentCanonical {
  const o = obj(raw);
  const cc = obj(o.conversation_config);
  const agent = obj(cc.agent);
  const prompt = obj(agent.prompt);
  const tts = obj(cc.tts);
  const toolIds = Array.isArray(prompt.tool_ids)
    ? prompt.tool_ids.filter((t): t is string => typeof t === 'string').slice().sort()
    : [];
  return {
    name: str(o.name),
    language: str(agent.language),
    firstMessage: str(agent.first_message),
    prompt: str(prompt.prompt),
    llm: str(prompt.llm),
    temperature: typeof prompt.temperature === 'number' ? prompt.temperature : null,
    voiceId: str(tts.voice_id),
    modelId: str(tts.model_id),
    toolIds,
  };
}

export interface AgentDrift {
  inSync: boolean;
  changedFields: string[]; // field NAMES only — never the prompt/config VALUES
}

const SCALAR_KEYS = [
  'name',
  'language',
  'firstMessage',
  'prompt',
  'llm',
  'temperature',
  'voiceId',
  'modelId',
] as const;

// Pure comparison of two canonical configs. Reports only the NAMES of fields that
// differ — a prompt/first-message diff is flagged by name, its content is never
// surfaced (PII/IP-safe, and Slack-safe for the eventual alert).
export function compareAgentCanonical(live: AgentCanonical, file: AgentCanonical): AgentDrift {
  const changedFields: string[] = [];
  for (const k of SCALAR_KEYS) {
    if (live[k] !== file[k]) changedFields.push(k);
  }
  if (live.toolIds.join(',') !== file.toolIds.join(',')) changedFields.push('toolIds');
  return { inSync: changedFields.length === 0, changedFields };
}
