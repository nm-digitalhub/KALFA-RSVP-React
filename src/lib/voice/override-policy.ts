import 'server-only';

import { getElevenLabsApiKey } from '@/lib/data/elevenlabs-status';

// A-13 AS A SYSTEM RULE, not a UI rule.
//
// ⚠️ THE RULE. A conversation-config override may leave this server only when
// BOTH hold: the value is non-empty, AND the target agent has that override
// enabled in its `platform_settings.overrides`. Otherwise it is omitted.
//
// ⚠️ WHY A UI RULE IS NOT ENOUGH, which is the whole reason this module exists.
// Hiding a field in the property panel stops a person from typing a value; it
// does nothing about a value that is already there. A diagram saved before the
// agent's flag was turned off, a workflow imported from JSON, a row edited in
// the database, a purpose whose agent was swapped afterwards — each of those
// carries an override the editor would never have offered, and each reaches the
// scenario through exactly the same code path as a freshly-typed one. The
// invariant has to live where the value is minted, which is here.
//
// ⚠️ AND WHY GETTING IT WRONG IS NOT COSMETIC. ElevenLabs' own documentation is
// explicit that for most fields "an error will be thrown if an override is
// provided when that field does not have overrides enabled". A soft, silent
// discard is the EXCEPTION (asr.keywords, tts.supported_voices), not the rule.
// So an override sent without the flag does not degrade the call — it can fail
// it, after the phone has already rung.
//
// ⚠️ FAIL-CLOSED, ALWAYS. Every failure to PROVE the override is allowed — a
// missing API key, a timeout, a 500, an agent that no longer exists — omits the
// override. Omitting is always safe: the agent falls back to its configured
// value and the call sounds normal. Sending on an unproven assumption is the
// only outcome that can break a live call, so absence of proof is treated as
// absence of permission.

const AGENT_URL = 'https://api.elevenlabs.io/v1/convai/agents/';
const TIMEOUT_MS = 4_000;
// A short in-process cache, because this sits on the DIAL PATH: the scenario
// fetches ctx and only then places the call, so every millisecond here is a
// millisecond of silence before the phone rings. Short enough that turning a
// flag off at ElevenLabs takes effect within a minute; long enough that a burst
// of calls to one agent pays for one lookup.
const CACHE_TTL_MS = 60_000;

/** The override fields this codebase knows how to send. */
export type OverrideField = 'first_message' | 'prompt' | 'language';

type CacheEntry = { at: number; allowed: Set<OverrideField> | null };
const cache = new Map<string, CacheEntry>();

type AgentOverrides = {
  platform_settings?: {
    overrides?: {
      conversation_config_override?: {
        agent?: {
          first_message?: unknown;
          prompt?: { prompt?: unknown } | unknown;
          language?: unknown;
        };
      };
    };
  };
};

/**
 * Which overrides this agent actually permits, read live.
 *
 * `null` means "could not be determined" — deliberately distinct from an empty
 * set, so a caller that wants to log the difference can. Both outcomes omit.
 */
async function readAllowedOverrides(agentId: string): Promise<Set<OverrideField> | null> {
  const cached = cache.get(agentId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.allowed;

  let allowed: Set<OverrideField> | null = null;
  try {
    const key = await getElevenLabsApiKey();
    if (key) {
      const res = await fetch(`${AGENT_URL}${encodeURIComponent(agentId)}`, {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (res.ok) {
        const body = (await res.json()) as AgentOverrides;
        const agent = body.platform_settings?.overrides?.conversation_config_override?.agent;
        const set = new Set<OverrideField>();
        // `=== true` and not truthiness: the server returns booleans here, and a
        // string "false" or a 0 must never read as permission.
        if (agent?.first_message === true) set.add('first_message');
        if (agent?.language === true) set.add('language');
        // `prompt` is nested one level deeper in the config's own shape
        // (`agent.prompt.prompt`), so both spellings are accepted rather than
        // guessing which one this account's config uses.
        const prompt = agent?.prompt as { prompt?: unknown } | boolean | undefined;
        if (prompt === true || (prompt && typeof prompt === 'object' && prompt.prompt === true)) {
          set.add('prompt');
        }
        allowed = set;
      }
    }
  } catch {
    // Timeout, DNS, TLS, a malformed body — all of them mean "not proven".
    allowed = null;
  }

  cache.set(agentId, { at: Date.now(), allowed });
  return allowed;
}

/**
 * The overrides that may be sent for this agent, with everything unproven dropped.
 *
 * Pass the candidate values; get back only the ones that are both non-empty and
 * permitted. An empty result is a normal outcome, not an error — the caller
 * spreads it and the agent uses its own configuration.
 *
 * ⚠️ `agentId` EMPTY MEANS THE SCENARIO PICKS THE AGENT, which is the state
 * every deployed scenario is in today (each hardcodes its own `AGENT_ID`). The
 * override cannot be checked against an agent this server cannot name, so it is
 * dropped — the same fail-closed rule, applied to the same missing proof.
 */
export async function allowedOverrides(
  agentId: string | null | undefined,
  candidates: Partial<Record<OverrideField, string>>,
): Promise<Partial<Record<OverrideField, string>>> {
  const wanted = (Object.entries(candidates) as [OverrideField, string | undefined][]).filter(
    ([, value]) => typeof value === 'string' && value.trim() !== '',
  );
  if (wanted.length === 0) return {};
  if (!agentId) return {};

  const allowed = await readAllowedOverrides(agentId);
  if (!allowed) return {};

  const out: Partial<Record<OverrideField, string>> = {};
  for (const [field, value] of wanted) {
    if (allowed.has(field)) out[field] = value as string;
  }
  return out;
}

/** Test seam. Never called in production — the TTL is the production mechanism. */
export function __clearOverridePolicyCache(): void {
  cache.clear();
}
