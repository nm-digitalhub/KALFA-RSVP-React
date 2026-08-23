import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RelocateExecuteLatchError,
  patchSupabaseAuthConfig,
  projectRefFromSupabaseUrl,
  runSupabaseSql,
  subscribeMetaWebhook,
  supabaseMgmtToken,
} from "./external";

const TOKEN = "sbp_SECRET_TOKEN_VALUE_1234567890";

let savedLatch: string | undefined;
beforeEach(() => {
  savedLatch = process.env.RELOCATE_EXECUTE;
});
afterEach(() => {
  if (savedLatch === undefined) delete process.env.RELOCATE_EXECUTE;
  else process.env.RELOCATE_EXECUTE = savedLatch;
  vi.unstubAllGlobals();
});

describe("supabaseMgmtToken resolver", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("env wins over the CLI file", () => {
    dir = mkdtempSync(join(tmpdir(), "relocate-ext-"));
    mkdirSync(join(dir, ".supabase"));
    writeFileSync(join(dir, ".supabase", "access-token"), "sbp_from_file\n");
    const r = supabaseMgmtToken({ env: { SUPABASE_ACCESS_TOKEN: "sbp_from_env" }, homeDir: dir });
    expect(r).toEqual({ token: "sbp_from_env", source: "env" });
  });

  it("falls back to ~/.supabase/access-token (trimmed)", () => {
    dir = mkdtempSync(join(tmpdir(), "relocate-ext-"));
    mkdirSync(join(dir, ".supabase"));
    writeFileSync(join(dir, ".supabase", "access-token"), "sbp_from_file\n");
    const r = supabaseMgmtToken({ env: {}, homeDir: dir });
    expect(r).toEqual({ token: "sbp_from_file", source: "cli-file" });
  });

  it("neither source → null", () => {
    dir = mkdtempSync(join(tmpdir(), "relocate-ext-"));
    expect(supabaseMgmtToken({ env: {}, homeDir: dir })).toBeNull();
  });
});

describe("projectRefFromSupabaseUrl", () => {
  it("derives the ref and refuses non-supabase hosts", () => {
    expect(projectRefFromSupabaseUrl("https://abcdefghij.supabase.co")).toBe("abcdefghij");
    expect(() => projectRefFromSupabaseUrl("https://example.com")).toThrow();
  });
});

describe("patchSupabaseAuthConfig", () => {
  it("GETs the previous config first, merges redirects, returns prevValue", async () => {
    process.env.RELOCATE_EXECUTE = "1";
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (!init?.method || init.method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              site_url: "https://old.example",
              uri_allow_list: "https://old.example/a, https://old.example/b",
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );

    const r = await patchSupabaseAuthConfig({
      token: TOKEN,
      projectRef: "abcdefghij",
      siteUrl: "https://new.example",
      additionalRedirects: ["https://new.example/**", "https://old.example/a"],
    });

    expect(r.ok).toBe(true);
    expect(r.prevValue).toEqual({
      site_url: "https://old.example",
      uri_allow_list: "https://old.example/a, https://old.example/b",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[1].init?.method).toBe("PATCH");
    const patchBody = JSON.parse(String(calls[1].init?.body)) as {
      site_url: string;
      uri_allow_list: string;
    };
    expect(patchBody.site_url).toBe("https://new.example");
    // merged, deduped, nothing dropped:
    expect(patchBody.uri_allow_list.split(",")).toEqual([
      "https://old.example/a",
      "https://old.example/b",
      "https://new.example/**",
    ]);
  });

  it("latch off → throws before any network call", async () => {
    delete process.env.RELOCATE_EXECUTE;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      patchSupabaseAuthConfig({
        token: TOKEN,
        projectRef: "abcdefghij",
        siteUrl: "https://new.example",
        additionalRedirects: [],
      }),
    ).rejects.toBeInstanceOf(RelocateExecuteLatchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("failure details never contain the token", async () => {
    process.env.RELOCATE_EXECUTE = "1";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const r = await patchSupabaseAuthConfig({
      token: TOKEN,
      projectRef: "abcdefghij",
      siteUrl: "https://new.example",
      additionalRedirects: [],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("runSupabaseSql", () => {
  it("read-only queries run without the latch and send read_only:true", async () => {
    delete process.env.RELOCATE_EXECUTE;
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 201, json: async () => [{ one: 1 }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const r = await runSupabaseSql({
      token: TOKEN,
      projectRef: "abcdefghij",
      query: "select 1",
      readOnly: true,
    });
    expect(r.ok).toBe(true);
    const [, sqlInit] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(sqlInit.body)) as { read_only: boolean };
    expect(body.read_only).toBe(true);
  });

  it("a write with the latch off throws before any network call", async () => {
    delete process.env.RELOCATE_EXECUTE;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      runSupabaseSql({ token: TOKEN, projectRef: "abcdefghij", query: "update x", readOnly: false }),
    ).rejects.toBeInstanceOf(RelocateExecuteLatchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("transport failure detail never contains the token", async () => {
    delete process.env.RELOCATE_EXECUTE;
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("socket hang up"))));
    const r = await runSupabaseSql({
      token: TOKEN,
      projectRef: "abcdefghij",
      query: "select 1",
      readOnly: true,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("subscribeMetaWebhook", () => {
  it("POSTs the documented shape with the app token in the BODY, never the URL", async () => {
    process.env.RELOCATE_EXECUTE = "1";
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);
    const r = await subscribeMetaWebhook({
      appId: "123456",
      appToken: "123456|APPSECRETVALUE",
      callbackUrl: "https://new.example/api/webhooks/whatsapp",
      verifyToken: "vt",
    });
    expect(r.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/123456/subscriptions");
    expect(url).not.toContain("APPSECRETVALUE");
    const body = init.body as URLSearchParams;
    expect(body.get("object")).toBe("whatsapp_business_account");
    expect(body.get("callback_url")).toBe("https://new.example/api/webhooks/whatsapp");
    expect(body.get("verify_token")).toBe("vt");
    expect(body.get("fields")).toBe("messages");
    expect(body.get("access_token")).toBe("123456|APPSECRETVALUE");
  });

  it("latch off → throws before any network call", async () => {
    delete process.env.RELOCATE_EXECUTE;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      subscribeMetaWebhook({
        appId: "1",
        appToken: "t",
        callbackUrl: "https://x/api/webhooks/whatsapp",
        verifyToken: "v",
      }),
    ).rejects.toBeInstanceOf(RelocateExecuteLatchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
