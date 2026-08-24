import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExecuteLatchError } from "./exec";
import {
  agentKbItems,
  createKbFolder,
  createKbUrlDocument,
  loadElApiKey,
  patchToolUrl,
  pullAgentConfig,
  pushAgentConfig,
  readAgentsJson,
  rebaseUrl,
  rewriteAgentKb,
  toolsOnHost,
  urlOnHost,
  type ElTool,
} from "./elevenlabs-relocate";

const repoRoot = join(__dirname, "..", "..", "..");

// Shape copied from the LIVE tool (2026-08-24, agents_list_tools).
const webhookTool: ElTool = {
  id: "tool_5701",
  tool_config: {
    type: "webhook",
    name: "lookup_guest_rsvp",
    api_schema: { url: "https://old.example/api/agent/rsvp-lookup", method: "POST" },
  },
};
const clientTool: ElTool = { id: "tool_1501", tool_config: { type: "client", name: "save_rsvp" } };

describe("tools", () => {
  it("toolsOnHost selects webhook tools by URL host only", () => {
    expect(toolsOnHost([webhookTool, clientTool], "old.example").map((t) => t.id)).toEqual(["tool_5701"]);
    expect(toolsOnHost([webhookTool, clientTool], "other.example")).toEqual([]);
  });

  it("rebaseUrl keeps path/query, swaps origin", () => {
    expect(rebaseUrl("https://old.example/api/agent/rsvp-lookup?x=1", "https://new.example")).toBe(
      "https://new.example/api/agent/rsvp-lookup?x=1",
    );
  });
});

describe("agent configs", () => {
  it("agents.json lists the four live agents with config paths", () => {
    const agents = readAgentsJson(repoRoot);
    expect(agents.length).toBeGreaterThanOrEqual(4);
    for (const a of agents) {
      expect(a.id).toMatch(/^agent_/);
      expect(a.config).toMatch(/^agent_configs\/.+\.json$/);
    }
  });

  it("rewriteAgentKb swaps only the mapped knowledge-base items in a REAL pulled config and never mutates the input", () => {
    const entry = readAgentsJson(repoRoot).find((a) => a.config.includes("Sales-Close"));
    expect(entry).toBeDefined();
    const config = JSON.parse(readFileSync(join(repoRoot, entry!.config), "utf8")) as unknown;
    const before = agentKbItems(config);
    expect(before.length).toBeGreaterThan(0);
    const target = before.find((i) => i.type === "folder") ?? before[0];
    const { config: next, changed } = rewriteAgentKb(
      config,
      new Map([[target.id, { type: target.type, name: "NEW", id: "kb_new" }]]),
    );
    expect(changed).toBe(true);
    const after = agentKbItems(next);
    expect(after.length).toBe(before.length);
    expect(after.find((i) => i.id === "kb_new")).toMatchObject({ name: "NEW", type: target.type, usage_mode: target.usage_mode });
    expect(after.filter((i) => i.id !== "kb_new")).toEqual(before.filter((i) => i.id !== target.id));
    // input untouched
    expect(agentKbItems(config).map((i) => i.id)).toContain(target.id);
    // untouched map → unchanged
    expect(rewriteAgentKb(config, new Map()).changed).toBe(false);
  });

  it("urlOnHost / loadElApiKey", () => {
    expect(urlOnHost("https://old.example/faq", "old.example")).toBe(true);
    expect(urlOnHost("https://x.example/faq", "old.example")).toBe(false);
    expect(urlOnHost(undefined, "old.example")).toBe(false);
    expect(loadElApiKey({})).toBeNull();
    expect(loadElApiKey({ ELEVENLABS_API_KEY: " k " })).toBe("k");
  });
});

describe("execute latch", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.RELOCATE_EXECUTE;
    delete process.env.RELOCATE_EXECUTE;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.RELOCATE_EXECUTE;
    else process.env.RELOCATE_EXECUTE = saved;
    vi.unstubAllGlobals();
  });

  it("every mutating helper refuses without RELOCATE_EXECUTE=1 and never calls fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(patchToolUrl("k", webhookTool, "https://new.example/x")).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(createKbFolder("k", "f")).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(createKbUrlDocument("k", { url: "https://new.example/faq" })).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(pullAgentConfig("/repo", "agent_x")).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(pushAgentConfig("/repo", "agent_x", "d")).rejects.toBeInstanceOf(ExecuteLatchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("patchToolUrl sends the server's own tool_config with only the URL re-based, key in header only", async () => {
    process.env.RELOCATE_EXECUTE = "1";
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const res = await patchToolUrl("XI-KEY", webhookTool, "https://new.example/api/agent/rsvp-lookup");
    expect(res).toEqual({ ok: true, detail: "lookup_guest_rsvp → https://new.example/api/agent/rsvp-lookup", prevUrl: "https://old.example/api/agent/rsvp-lookup" });
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/convai/tools/tool_5701");
    expect(calls[0].init?.method).toBe("PATCH");
    expect((calls[0].init?.headers as Record<string, string>)["xi-api-key"]).toBe("XI-KEY");
    const body = JSON.parse(String(calls[0].init?.body)) as { tool_config: ElTool["tool_config"] };
    expect(body.tool_config).toEqual({
      type: "webhook",
      name: "lookup_guest_rsvp",
      api_schema: { url: "https://new.example/api/agent/rsvp-lookup", method: "POST" },
    });
  });
});
