import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ENV_KEY_SPECS,
  classifyHttpProbe,
  outcomeHe,
  PROBES,
  probeVapidLocal,
  validateFormat,
} from "./env-validation";
import { parseEnvFile } from "./preflight";

describe("ENV_KEY_SPECS catalog", () => {
  it("stays 1:1 with .env.example — the wizard's key source of truth", () => {
    const exampleKeys = Object.keys(
      parseEnvFile(readFileSync(join(process.cwd(), ".env.example"), "utf8")),
    ).sort();
    const specKeys = ENV_KEY_SPECS.map((s) => s.key).sort();
    expect(specKeys).toEqual(exampleKeys);
  });

  it("VAPID keypair is generated, never user-entered; SUMIT is skippable (no read-only probe)", () => {
    const byKey = Object.fromEntries(ENV_KEY_SPECS.map((s) => [s.key, s]));
    expect(byKey.NEXT_PUBLIC_VAPID_PUBLIC_KEY.kind).toBe("generated");
    expect(byKey.VAPID_PRIVATE_KEY.kind).toBe("generated");
    expect(byKey.SUMIT_API_KEY.kind).toBe("format");
    expect(byKey.SUMIT_API_KEY.skippable).toBe(true);
  });
});

describe("validateFormat", () => {
  it("accepts valid values and rejects malformed ones with the reason", () => {
    expect(validateFormat("APP_ORIGIN", "https://new.example")).toEqual({ ok: true });
    const bad = validateFormat("APP_ORIGIN", "https://new.example/path");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.class).toBe("format");
    expect(validateFormat("NEXT_PUBLIC_GA_ID", "G-ABC123")).toEqual({ ok: true });
    expect(validateFormat("NEXT_PUBLIC_GA_ID", "UA-1234").ok).toBe(false);
    expect(validateFormat("EXCHANGE_PROVIDER", "graph")).toEqual({ ok: true });
    expect(validateFormat("EXCHANGE_PROVIDER", "ews").ok).toBe(false);
  });
});

describe("classifyHttpProbe — the two failure classes stay distinguishable", () => {
  it("2xx ok; 401/403 auth; transport error network; other statuses auth (never ok)", () => {
    expect(classifyHttpProbe({ kind: "response", status: 200 })).toEqual({ ok: true });
    expect(classifyHttpProbe({ kind: "response", status: 401 })).toMatchObject({ ok: false, class: "auth" });
    expect(classifyHttpProbe({ kind: "response", status: 403 })).toMatchObject({ ok: false, class: "auth" });
    expect(classifyHttpProbe({ kind: "response", status: 404 })).toMatchObject({ ok: false, class: "auth" });
    expect(classifyHttpProbe({ kind: "transport-error", message: "timeout" })).toMatchObject({
      ok: false,
      class: "network",
    });
  });

  it("renders distinct Hebrew feedback per class", () => {
    expect(outcomeHe({ ok: true })).toContain("אומת");
    expect(outcomeHe({ ok: false, class: "auth", reason: "x" })).toContain("נדחה");
    expect(outcomeHe({ ok: false, class: "network", reason: "x" })).toContain("רשת");
  });
});

describe("fetch-based probes (mocked transport — no real calls)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("supabase-anon: 200 → ok, 401 → auth, refused → network", async () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    expect(await PROBES["supabase-anon"](env)).toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
    expect(await PROBES["supabase-anon"](env)).toMatchObject({ ok: false, class: "auth" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await PROBES["supabase-anon"](env)).toMatchObject({ ok: false, class: "network" });
  });

  it("meta-token: is_valid=false is an AUTH failure even with HTTP 200", async () => {
    const env = { META_APP_ID: "1", META_APP_SECRET: "s", META_ADS_ACCESS_TOKEN: "t" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { is_valid: false } }) }),
    );
    expect(await PROBES["meta-token"](env)).toMatchObject({ ok: false, class: "auth" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { is_valid: true } }) }),
    );
    expect(await PROBES["meta-token"](env)).toEqual({ ok: true });
  });
});

describe("probeVapidLocal — real web-push validation, no network", () => {
  it("accepts a freshly generated pair and rejects a mismatched one", async () => {
    const webpush = (await import("web-push")).default;
    const pair = webpush.generateVAPIDKeys();
    expect(
      await probeVapidLocal({
        VAPID_SUBJECT: "mailto:admin@example.com",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: pair.publicKey,
        VAPID_PRIVATE_KEY: pair.privateKey,
      }),
    ).toEqual({ ok: true });
    expect(
      (
        await probeVapidLocal({
          VAPID_SUBJECT: "mailto:admin@example.com",
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: "not-a-key",
          VAPID_PRIVATE_KEY: pair.privateKey,
        })
      ).ok,
    ).toBe(false);
  });
});
