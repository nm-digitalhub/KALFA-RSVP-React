/**
 * Relocation wizard — ElevenLabs (Stage F8 / F9).
 *
 * Live inventory 2026-08-24 (MCP agents_list_tools / agents_get): the app
 * origin is bound in exactly two places on the ElevenLabs side —
 *   1. webhook tools whose api_schema.url targets the origin (today ONE:
 *      lookup_guest_rsvp → /api/agent/rsvp-lookup); every other tool is a
 *      `client` tool with no URL;
 *   2. knowledge-base documents of type `url` (and crawl-job FOLDERS of url
 *      documents) attached to an agent's prompt.knowledge_base — today the
 *      Sales-Close agent's FAQ page and the sitemap crawl folder.
 *
 * Mechanics (live-doc verified 2026-08-24):
 *   PATCH /v1/convai/tools/{tool_id}  {tool_config}      — F8, direct: the
 *     body is the server's own GET'd tool_config with one field changed, so
 *     the canonical shape is preserved.
 *   POST  /v1/convai/knowledge-base/url    {url, name, parent_folder_id}
 *   POST  /v1/convai/knowledge-base/folder {name}
 *   GET   /v1/convai/knowledge-base?parent_folder_id=…  (folder children)
 *   Agent KB list changes go THROUGH THE CLI (CLAUDE.md: never PATCH the
 *   agent directly): `elevenlabs agents pull --agent <id> --update` →
 *   edit agent_configs/<file>.json → `elevenlabs agents push --agent <id>`.
 * Old documents/folders are left in place (never deleted) — they simply stop
 * being attached; the report lists them for a later manual clean-up.
 *
 * Mutating functions check the RELOCATE_EXECUTE latch; the API key travels
 * in the xi-api-key header only.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertExecuteLatch, backupFile, runCommand, type RunCommandResult } from "./exec";

const API = "https://api.elevenlabs.io/v1/convai";
const TIMEOUT_MS = 15_000;

export function loadElApiKey(env: Record<string, string>): string | null {
  const key = env.ELEVENLABS_API_KEY?.trim();
  return key || null;
}

function headers(apiKey: string, json = false): Record<string, string> {
  return json
    ? { "xi-api-key": apiKey, "content-type": "application/json" }
    : { "xi-api-key": apiKey };
}

/* ------------------------------------------------------------------------- *
 * Tools
 * ------------------------------------------------------------------------- */

export interface ElTool {
  id: string;
  tool_config: {
    type: string;
    name?: string;
    api_schema?: { url?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
}

export async function listElTools(apiKey: string): Promise<ElTool[]> {
  const out: ElTool[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    guard += 1;
    const url = `${API}/tools?page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res: Response = await fetch(url, { headers: headers(apiKey), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ElevenLabs tools list failed: HTTP ${res.status}`);
    const body = (await res.json()) as { tools?: ElTool[]; next_cursor?: string | null; has_more?: boolean };
    out.push(...(body.tools ?? []));
    cursor = body.has_more && body.next_cursor ? body.next_cursor : null;
  } while (cursor && guard < 20);
  return out;
}

export function toolUrl(tool: ElTool): string | null {
  const u = tool.tool_config?.api_schema?.url;
  return typeof u === "string" ? u : null;
}

/** Webhook tools whose URL points at `host` (pure). */
export function toolsOnHost(tools: ElTool[], host: string): ElTool[] {
  return tools.filter((t) => {
    const u = toolUrl(t);
    if (!u || t.tool_config.type !== "webhook") return false;
    try {
      return new URL(u).hostname === host;
    } catch {
      return false;
    }
  });
}

export function rebaseUrl(url: string, newOrigin: string): string {
  const u = new URL(url);
  return `${newOrigin}${u.pathname}${u.search}${u.hash}`;
}

/** MUTATING. PATCHes the tool with its own config, URL re-based. */
export async function patchToolUrl(
  apiKey: string,
  tool: ElTool,
  newUrl: string,
): Promise<{ ok: boolean; detail: string; prevUrl: string | null }> {
  assertExecuteLatch(`patchToolUrl(${tool.id})`);
  const prevUrl = toolUrl(tool);
  const toolConfig = {
    ...tool.tool_config,
    api_schema: { ...(tool.tool_config.api_schema ?? {}), url: newUrl },
  };
  try {
    const res = await fetch(`${API}/tools/${encodeURIComponent(tool.id)}`, {
      method: "PATCH",
      headers: headers(apiKey, true),
      body: JSON.stringify({ tool_config: toolConfig }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, prevUrl };
    return { ok: true, detail: `${tool.tool_config.name ?? tool.id} → ${newUrl}`, prevUrl };
  } catch (err) {
    return { ok: false, detail: transportDetail(err), prevUrl };
  }
}

export async function getElTool(apiKey: string, toolId: string): Promise<ElTool | null> {
  const res = await fetch(`${API}/tools/${encodeURIComponent(toolId)}`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return (await res.json()) as ElTool;
}

/* ------------------------------------------------------------------------- *
 * Knowledge base
 * ------------------------------------------------------------------------- */

export interface ElKbDoc {
  id: string;
  name: string;
  type: string; // url | file | text | folder
  url?: string;
}

export async function listKbDocuments(apiKey: string, parentFolderId?: string): Promise<ElKbDoc[]> {
  const out: ElKbDoc[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    guard += 1;
    const q = new URLSearchParams({ page_size: "100" });
    if (parentFolderId) q.set("parent_folder_id", parentFolderId);
    if (cursor) q.set("cursor", cursor);
    const res: Response = await fetch(`${API}/knowledge-base?${q.toString()}`, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ElevenLabs knowledge-base list failed: HTTP ${res.status}`);
    const body = (await res.json()) as { documents?: ElKbDoc[]; next_cursor?: string | null; has_more?: boolean };
    out.push(...(body.documents ?? []));
    cursor = body.has_more && body.next_cursor ? body.next_cursor : null;
  } while (cursor && guard < 20);
  return out;
}

export async function getKbDocument(apiKey: string, id: string): Promise<ElKbDoc | null> {
  const res = await fetch(`${API}/knowledge-base/${encodeURIComponent(id)}`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return (await res.json()) as ElKbDoc;
}

/** Every url-type document under a folder, recursively (depth-capped). */
export async function collectFolderUrlDocs(apiKey: string, folderId: string, depth = 0): Promise<ElKbDoc[]> {
  if (depth > 4) return [];
  const children = await listKbDocuments(apiKey, folderId);
  const out: ElKbDoc[] = [];
  for (const c of children) {
    if (c.type === "url") out.push(c);
    else if (c.type === "folder") out.push(...(await collectFolderUrlDocs(apiKey, c.id, depth + 1)));
  }
  return out;
}

export function urlOnHost(url: string | undefined, host: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === host;
  } catch {
    return false;
  }
}

/** MUTATING. */
export async function createKbFolder(apiKey: string, name: string): Promise<{ id: string; name: string }> {
  assertExecuteLatch("createKbFolder");
  const res = await fetch(`${API}/knowledge-base/folder`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`knowledge-base folder create failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string; name: string };
}

/** MUTATING. */
export async function createKbUrlDocument(
  apiKey: string,
  opts: { url: string; name?: string; parentFolderId?: string },
): Promise<{ id: string; name: string }> {
  assertExecuteLatch("createKbUrlDocument");
  const res = await fetch(`${API}/knowledge-base/url`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: JSON.stringify({
      url: opts.url,
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.parentFolderId ? { parent_folder_id: opts.parentFolderId } : {}),
    }),
    signal: AbortSignal.timeout(60_000), // the platform fetches the page synchronously
  });
  if (!res.ok) throw new Error(`knowledge-base url create failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string; name: string };
}

/* ------------------------------------------------------------------------- *
 * Agent configs (CLI-managed files)
 * ------------------------------------------------------------------------- */

export interface AgentEntry {
  id: string;
  config: string; // path relative to repo root
  name?: string;
}

export function readAgentsJson(repoRoot: string): AgentEntry[] {
  const path = join(repoRoot, "agents.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { agents?: AgentEntry[] };
    return (parsed.agents ?? []).filter((a) => typeof a.id === "string" && typeof a.config === "string");
  } catch {
    return [];
  }
}

export interface KbItem {
  type: string;
  name: string;
  id: string;
  usage_mode?: string;
}

/** Live read of one agent's knowledge_base list (GET /agents/{id}, read-only —
 * the truth is the platform, not the pulled file). */
export async function getElAgentKb(apiKey: string, agentId: string): Promise<KbItem[] | null> {
  const res = await fetch(`${API}/agents/${encodeURIComponent(agentId)}`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return agentKbItems(await res.json());
}

/** The agent's prompt.knowledge_base list from a pulled config (pure). */
export function agentKbItems(config: unknown): KbItem[] {
  const kb = (config as { conversation_config?: { agent?: { prompt?: { knowledge_base?: unknown } } } })
    ?.conversation_config?.agent?.prompt?.knowledge_base;
  return Array.isArray(kb) ? (kb as KbItem[]) : [];
}

/** Returns a deep-copied config whose knowledge_base items are replaced per
 * `replacements` (old id → new item); `changed` = anything swapped (pure). */
export function rewriteAgentKb(
  config: unknown,
  replacements: ReadonlyMap<string, KbItem>,
): { config: unknown; changed: boolean } {
  const clone = structuredClone(config) as {
    conversation_config?: { agent?: { prompt?: { knowledge_base?: KbItem[] } } };
  };
  const list = clone?.conversation_config?.agent?.prompt?.knowledge_base;
  if (!Array.isArray(list)) return { config: clone, changed: false };
  let changed = false;
  clone.conversation_config!.agent!.prompt!.knowledge_base = list.map((item) => {
    const next = replacements.get(item.id);
    if (!next) return item;
    changed = true;
    return { ...item, ...next, usage_mode: item.usage_mode ?? next.usage_mode };
  });
  return { config: clone, changed };
}

/** Pull one agent's config with the CLI (writes agent_configs/<file>.json —
 * local files only, no platform mutation; still latched because it rewrites
 * tracked files). */
export async function pullAgentConfig(repoRoot: string, agentId: string): Promise<RunCommandResult> {
  assertExecuteLatch(`pullAgentConfig(${agentId})`);
  return runCommand({
    cmd: "elevenlabs",
    args: ["agents", "pull", "--agent", agentId, "--update", "--no-ui"],
    cwd: repoRoot,
    input: "y\n",
    timeoutMs: 120_000,
  });
}

/** MUTATING (live agent). */
export async function pushAgentConfig(
  repoRoot: string,
  agentId: string,
  versionDescription: string,
): Promise<RunCommandResult> {
  assertExecuteLatch(`pushAgentConfig(${agentId})`);
  return runCommand({
    cmd: "elevenlabs",
    args: ["agents", "push", "--agent", agentId, "--version-description", versionDescription, "--no-ui"],
    cwd: repoRoot,
    input: "y\n",
    timeoutMs: 120_000,
  });
}

export function readAgentConfig(repoRoot: string, entry: AgentEntry): unknown {
  return JSON.parse(readFileSync(join(repoRoot, entry.config), "utf8"));
}

export function writeAgentConfig(
  repoRoot: string,
  entry: AgentEntry,
  config: unknown,
): { path: string; backupPath: string } {
  const path = join(repoRoot, entry.config);
  const backup = backupFile(path);
  writeFileSync(path, `${JSON.stringify(config, null, 4)}\n`);
  return backup;
}

function transportDetail(err: unknown): string {
  const e = err as Error;
  if (e?.name === "TimeoutError") return "timeout";
  return e?.message?.slice(0, 200) || "transport error";
}
