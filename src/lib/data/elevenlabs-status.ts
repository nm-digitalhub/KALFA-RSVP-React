import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createAdminClient } from '@/lib/supabase/admin';

// ElevenLabs read-only status for the voice-ops dashboard "agent fleet" panel.
// Everything is READ-ONLY — agent editing stays in the IaC/CLI flow (agents.json
// + agent_configs/). Fail-safe: a missing key or any API error degrades to an
// 'unavailable'/'unconfigured' section, never throws, never logs the key.
//
// Endpoints (base https://api.elevenlabs.io, header `xi-api-key`):
//   GET /v1/convai/agents/{id}          — agent details (DOCUMENTED: docs/voice-agent/elevenlabs-json-reference.md)
//   GET /v1/user/subscription           — usage/quota (VERIFY-LIVE: not in the local ref)
//   GET /v1/convai/conversations?agent_id=… — recent conversations (VERIFY-LIVE)

const API_BASE = 'https://api.elevenlabs.io';
const TIMEOUT_MS = 8000;

// The background quota cron gets a longer budget than the dashboard: nobody is
// waiting on it, and a single slow response must not be reported as a failure.
// MEASURED 2026-08-26: every quota tick for the preceding six days completed in
// 2–5s, then one took 9.1s and tripped the 8s dashboard budget — which the alert
// path then misreported as a missing API-key permission (see elevenlabs-quota.ts).
export const BACKGROUND_TIMEOUT_MS = 30000;

export type KeySource = 'db' | 'env' | null;

// Source of truth: the admin-managed app_settings column FIRST (so an admin can
// override via the dashboard form), falling back to the env var the IaC tooling
// already uses (ELEVENLABS_API_KEY — a CI/infra credential, consistent with the
// "env holds infra credentials" convention). Returns the key + which source it
// came from (so the UI can be honest about whether the form can clear it).
// Never logs the value.
export async function getElevenLabsApiKeyWithSource(): Promise<{ key: string | null; source: KeySource }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('elevenlabs_api_key')
      .eq('id', true)
      .maybeSingle();
    if (!error && data) {
      const k = (data as Record<string, unknown>).elevenlabs_api_key;
      if (typeof k === 'string' && k.trim() !== '') return { key: k, source: 'db' };
    }
  } catch {
    /* fall through to the env fallback */
  }
  const envKey = process.env.ELEVENLABS_API_KEY;
  if (typeof envKey === 'string' && envKey.trim() !== '') return { key: envKey, source: 'env' };
  return { key: null, source: null };
}

export async function getElevenLabsApiKey(): Promise<string | null> {
  return (await getElevenLabsApiKeyWithSource()).key;
}

export interface FleetAgent {
  id: string;
  name: string;
  versionId: string | null;
}

// Read the IaC agent registry (agents.json + agent_configs/*.json) from the repo
// root. Pure filesystem — no API. Fail-safe to an empty fleet.
export function readAgentFleet(cwd: string = process.cwd()): FleetAgent[] {
  try {
    const manifest = JSON.parse(readFileSync(join(cwd, 'agents.json'), 'utf8')) as {
      agents?: Array<{ id?: string; config?: string; version_id?: string }>;
    };
    const out: FleetAgent[] = [];
    for (const a of manifest.agents ?? []) {
      if (!a.id) continue;
      let name = a.id;
      if (a.config) {
        try {
          const cfg = JSON.parse(readFileSync(join(cwd, a.config), 'utf8')) as { name?: string };
          if (typeof cfg.name === 'string' && cfg.name) name = cfg.name;
        } catch {
          /* config unreadable — fall back to the id as the name */
        }
      }
      out.push({ id: a.id, name, versionId: a.version_id ?? null });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Why a failure happened — never collapsed to a bare null.
 *
 * The previous shape returned `null` for timeout, DNS failure, 401, 429 and a
 * malformed body alike, and the one consumer that alerts on it (the quota cron)
 * had no choice but to guess a cause. It guessed "the API key is missing the
 * user_read permission" and told an operator to go re-issue a perfectly good key.
 * Callers that genuinely don't care still get `null` via elevenFetchOrNull below;
 * callers that REPORT a failure to a human get the real reason.
 */
export type ElevenFailure =
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'network'; message: string }
  | { kind: 'http'; status: number; code: string | null; message: string | null }
  | { kind: 'malformed'; message: string };

export type ElevenResult<T> = { ok: true; data: T } | { ok: false; failure: ElevenFailure };

/**
 * Pull the error identity out of an ElevenLabs error body.
 *
 * VERIFIED LIVE 2026-08-26 against https://elevenlabs.io/docs/eleven-api/resources/errors.md:
 * every failed request returns JSON with a `detail` property. Current shape is an
 * object carrying `type` / `code` / `message` / `status` / `request_id` / `param`
 * (`status` is documented as a legacy field superseded by `code`). The older
 * help-center shape — still what 400/401 returns per
 * /docs/help-center/technical/api-error-code-400-or-401.md — is `{status, message}`,
 * e.g. `{"status": "invalid_api_key", "message": "Invalid API key"}`. Both are read
 * here, newest field first, so neither shape degrades to "unknown".
 */
function parseErrorBody(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== 'object') return { code: null, message: null };
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return { code: null, message: detail };
  if (!detail || typeof detail !== 'object') return { code: null, message: null };
  const d = detail as Record<string, unknown>;
  const code =
    typeof d.code === 'string' ? d.code : typeof d.status === 'string' ? d.status : null;
  const message = typeof d.message === 'string' ? d.message : null;
  return { code, message };
}

async function elevenFetchResult(
  path: string,
  key: string,
  timeoutMs: number = TIMEOUT_MS,
): Promise<ElevenResult<unknown>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError DOMException; everything
    // else here is a transport failure (DNS, TLS, connection reset).
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { ok: false, failure: { kind: 'timeout', timeoutMs } };
    }
    return {
      ok: false,
      failure: { kind: 'network', message: err instanceof Error ? err.message : 'unknown' },
    };
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* error bodies are documented as JSON, but never assume it parsed */
    }
    const { code, message } = parseErrorBody(body);
    return { ok: false, failure: { kind: 'http', status: res.status, code, message } };
  }

  try {
    return { ok: true, data: await res.json() };
  } catch (err) {
    return {
      ok: false,
      failure: {
        kind: 'malformed',
        message: err instanceof Error ? err.message : 'response body is not JSON',
      },
    };
  }
}

/**
 * Best-effort variant for the dashboard panels, which degrade a failed section
 * to "unavailable" and have no operator-facing message to get wrong. The alert
 * path deliberately does NOT use this.
 */
async function elevenFetch(path: string, key: string): Promise<unknown | null> {
  const result = await elevenFetchResult(path, key);
  return result.ok ? result.data : null;
}

export type AgentApiStatus = 'ok' | 'missing' | 'error';

// Recent-conversations summary for an agent (from /v1/convai/conversations).
// `count` is the number in the fetched page; `more` flags that the account has
// additional older conversations beyond that page (so the UI shows "N+").
export interface AgentConversations {
  count: number;
  more: boolean;
  lastAt: string | null; // ISO of the most recent conversation start
}

export interface ElevenLabsAgentStatus {
  id: string;
  name: string;
  status: AgentApiStatus;
  conversations: AgentConversations | null;
}

const CONVERSATIONS_PAGE = 100;

// Fetch + summarize recent conversations for one agent. Best-effort — null on
// any error or missing scope. Reads ids/timestamps only, never transcripts.
async function fetchAgentConversations(agentId: string, key: string): Promise<AgentConversations | null> {
  const data = await elevenFetch(
    `/v1/convai/conversations?agent_id=${encodeURIComponent(agentId)}&page_size=${CONVERSATIONS_PAGE}`,
    key,
  );
  if (!data || typeof data !== 'object') return null;
  const d = data as { conversations?: unknown; has_more?: unknown };
  if (!Array.isArray(d.conversations)) return null;
  let lastUnix = 0;
  for (const c of d.conversations) {
    const t = (c as { start_time_unix_secs?: unknown }).start_time_unix_secs;
    if (typeof t === 'number' && t > lastUnix) lastUnix = t;
  }
  return {
    count: d.conversations.length,
    more: d.has_more === true,
    lastAt: lastUnix > 0 ? new Date(lastUnix * 1000).toISOString() : null,
  };
}

export interface ElevenLabsQuota {
  characterCount: number | null;
  characterLimit: number | null;
  tier: string | null;
}

// Parse a /v1/user/subscription response into the metadata-only quota view.
// Null when the response is absent/non-object (missing key permission, transport
// failure).
function parseSubscription(sub: unknown): ElevenLabsQuota | null {
  if (!sub || typeof sub !== 'object') return null;
  const s = sub as Record<string, unknown>;
  return {
    characterCount: typeof s.character_count === 'number' ? s.character_count : null,
    characterLimit: typeof s.character_limit === 'number' ? s.character_limit : null,
    tier: typeof s.tier === 'string' ? s.tier : null,
  };
}

// Read the character quota for a given key (metadata-only). READ-ONLY, so it
// stays in this dashboard status module; the quota-ALERT cron lives in its own
// file (elevenlabs-quota.ts) and consumes this — mirroring how voximplant-
// balance.ts's runBalanceCheck consumes getAccountInfo from core.ts.
//
// Null-returning variant, for the dashboard panel only: it renders "unavailable"
// and never explains a cause, so it has nothing to get wrong. Anything that
// REPORTS the failure to a human must use getElevenLabsQuotaResult instead.
export async function getElevenLabsQuota(key: string): Promise<ElevenLabsQuota | null> {
  return parseSubscription(await elevenFetch('/v1/user/subscription', key));
}

/**
 * Quota read that preserves why it failed.
 *
 * VERIFIED LIVE 2026-08-26 against the published OpenAPI spec
 * (https://api.elevenlabs.io/openapi.json, GET /v1/user/subscription →
 * ExtendedSubscriptionResponseModel): `character_count` and `character_limit` are
 * BOTH in the schema's `required` list on the 200 response. A 200 that lacks them
 * is therefore a contract change on ElevenLabs' side, NOT a permission problem —
 * an under-permissioned key fails with 401 `invalid_api_key` long before it can
 * return a 200 (see /docs/help-center/technical/api-error-code-400-or-401.md).
 * That distinction is exactly what the previous code collapsed, and why a slow
 * response got reported to the operator as a bad API key.
 */
export async function getElevenLabsQuotaResult(
  key: string,
  timeoutMs: number = BACKGROUND_TIMEOUT_MS,
): Promise<ElevenResult<ElevenLabsQuota>> {
  const result = await elevenFetchResult('/v1/user/subscription', key, timeoutMs);
  if (!result.ok) return result;
  const quota = parseSubscription(result.data);
  if (!quota || quota.characterCount === null || quota.characterLimit === null) {
    return {
      ok: false,
      failure: {
        kind: 'malformed',
        message:
          'HTTP 200 without character_count/character_limit — both are required by the ' +
          'published /v1/user/subscription schema, so the API contract has changed',
      },
    };
  }
  return { ok: true, data: quota };
}

export interface ElevenLabsFleetStatus {
  configured: boolean;
  keySource: KeySource; // 'db' | 'env' | null — so the UI can be honest
  agents: ElevenLabsAgentStatus[];
  quota: ElevenLabsQuota | null;
}

export async function getElevenLabsFleetStatus(): Promise<ElevenLabsFleetStatus> {
  const fleet = readAgentFleet();
  const { key, source } = await getElevenLabsApiKeyWithSource();
  if (!key) {
    // Not configured: still show the IaC fleet (names/ids), no live status.
    return {
      configured: false,
      keySource: null,
      agents: fleet.map((a) => ({
        id: a.id,
        name: a.name,
        status: 'error' as const,
        conversations: null,
      })),
      quota: null,
    };
  }

  const agents: ElevenLabsAgentStatus[] = await Promise.all(
    fleet.map(async (a) => {
      const detail = await elevenFetch(`/v1/convai/agents/${a.id}`, key);
      if (detail === null) {
        return { id: a.id, name: a.name, status: 'missing' as const, conversations: null };
      }
      const name =
        typeof (detail as { name?: unknown }).name === 'string'
          ? ((detail as { name: string }).name)
          : a.name;
      const conversations = await fetchAgentConversations(a.id, key);
      return { id: a.id, name, status: 'ok' as const, conversations };
    }),
  );

  // Quota (VERIFY-LIVE endpoint). Best-effort — null when unavailable.
  const quota = await getElevenLabsQuota(key);

  return { configured: true, keySource: source, agents, quota };
}

// Persist the ElevenLabs API key (write-only secret; '' clears it). Admin-gated
// by the calling action. Never logs the value.
export async function setElevenLabsApiKey(key: string): Promise<void> {
  const admin = createAdminClient();
  const value = key.trim() === '' ? null : key.trim();
  const { error } = await admin
    .from('app_settings')
    .update({ elevenlabs_api_key: value } as never)
    .eq('id', true);
  if (error) throw new Error('שמירת מפתח ElevenLabs נכשלה');
}
