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

async function elevenFetch(path: string, key: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
  let quota: ElevenLabsQuota | null = null;
  const sub = await elevenFetch('/v1/user/subscription', key);
  if (sub && typeof sub === 'object') {
    const s = sub as Record<string, unknown>;
    quota = {
      characterCount: typeof s.character_count === 'number' ? s.character_count : null,
      characterLimit: typeof s.character_limit === 'number' ? s.character_limit : null,
      tier: typeof s.tier === 'string' ? s.tier : null,
    };
  }

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
