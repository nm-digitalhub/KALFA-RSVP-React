import 'server-only';

import { getElevenLabsApiKey } from '@/lib/data/elevenlabs-status';
import { requirePlatformPermission } from '@/lib/auth/dal';

// The account's ACTUAL ElevenLabs agents, read live.
//
// WHY NOT `readAgentFleet`. That reader exists and returns agents too — from
// `agents.json` and `agent_configs/*.json` on disk. It is the IaC registry: what
// this repo declares, at the commit that is deployed. An agent created in the
// dashboard this morning is absent from it, and one deleted there is still in
// it. For a picker whose whole job is to name a live agent, a repo snapshot is
// the wrong source; it would offer ids that 404 at call time and hide ids that
// work. The fleet reader keeps its own job (what we deploy) and this one answers
// a different question (what exists).
//
// ⚠️ ARCHIVED AGENTS ARE OMITTED, AND THE FILTER IS SENT EXPLICITLY.
// The Markdown rendering of the reference documents `archived` as defaulting to
// false; the HTML rendering of the same page lists it as optional with no stated
// default. Rather than pick which rendering to trust, the parameter is passed —
// an archived agent is precisely what nobody should be able to point a new call
// at, and that is too important to rest on a default that two renderings of one
// page describe differently.
//
// Verified against the live reference (elevenlabs.io/docs/api-reference/agents/
// list.md, fetched 2026-09-15): `GET /v1/convai/agents`, `page_size` capped at
// 100, response `{ agents: [{ agent_id, name, tags, ... }], has_more,
// next_cursor }`.
const AGENTS_URL = 'https://api.elevenlabs.io/v1/convai/agents';
const TIMEOUT_MS = 12_000;
const PAGE_SIZE = 100;
// A ceiling on pagination, not on the account. Three pages is 300 agents, far
// past any plausible roster here, and it bounds a cursor loop that a malformed
// `next_cursor` could otherwise keep alive.
const MAX_PAGES = 3;

export type ElevenLabsAgentOption = {
  agentId: string;
  name: string;
  tags: readonly string[];
};

export type ElevenLabsAgentsResult =
  | { ok: true; agents: ElevenLabsAgentOption[] }
  | { ok: false; message: string };

type AgentsPage = {
  agents?: Array<{ agent_id?: unknown; name?: unknown; tags?: unknown }>;
  has_more?: unknown;
  next_cursor?: unknown;
};

/**
 * The agents this account can dial, newest name-sorted, for a live picker.
 *
 * ⚠️ ON DEMAND ONLY — never in a page's render path. This is an external HTTP
 * call with unbounded latency, and the workflow editor must open whether or not
 * ElevenLabs is reachable. A failure is a message, never a throw: the caller
 * degrades to "the agent configured in the scenario", which is exactly what
 * dialled before the field existed.
 */
export async function listElevenLabsAgents(): Promise<ElevenLabsAgentsResult> {
  await requirePlatformPermission('manage_voice');

  const key = await getElevenLabsApiKey();
  if (!key) return { ok: false, message: 'חסר מפתח ElevenLabs — הגדירו אותו תחילה' };

  const agents: ElevenLabsAgentOption[] = [];
  let cursor: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(AGENTS_URL);
      url.searchParams.set('page_size', String(PAGE_SIZE));
      url.searchParams.set('archived', 'false');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url, {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!res.ok) {
        // The status, never the body: an upstream error body can carry account
        // detail that has no business on an admin screen.
        return { ok: false, message: `טעינת הסוכנים נכשלה (${res.status})` };
      }

      const body = (await res.json()) as AgentsPage;
      for (const a of body.agents ?? []) {
        if (typeof a.agent_id !== 'string' || !a.agent_id) continue;
        agents.push({
          agentId: a.agent_id,
          // A nameless agent is still dialable, and hiding it would make the
          // list lie about what the account contains.
          name: typeof a.name === 'string' && a.name ? a.name : a.agent_id,
          tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string') : [],
        });
      }

      cursor = typeof body.next_cursor === 'string' ? body.next_cursor : null;
      if (body.has_more !== true || !cursor) break;
    }
  } catch {
    // Timeout, DNS, TLS — all the same to the caller, and none of them are
    // worth a stack trace on screen.
    return { ok: false, message: 'טעינת הסוכנים נכשלה' };
  }

  // Stable, human order — an operator scans this list by name.
  agents.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { ok: true, agents };
}
