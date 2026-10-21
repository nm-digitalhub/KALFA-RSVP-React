import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ENV_KEY_SPECS,
  checkSupabaseDbTarget,
  classifyHttpProbe,
  DbConfigError,
  isSupabasePoolerHost,
  outcomeHe,
  PROBES,
  probeSupabaseDb,
  probeVapidLocal,
  supabaseDbPort,
  validateFormat,
} from "./env-validation";

// probeSupabaseDb's live connection, replaced so a test can see whether one was even attempted.
const pg = vi.hoisted(() => ({ clients: 0, ports: [] as unknown[] }));
vi.mock("pg", () => ({
  Client: class {
    constructor(options: { port?: unknown }) {
      pg.clients++;
      pg.ports.push(options.port);
    }
    async connect() {
      throw Object.assign(new Error("no network in unit tests"), { code: "ECONNREFUSED" });
    }
    async end() {}
  },
}));
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

describe("Supabase DB target — configuration check before any connection", () => {
  const POOLER = "aws-1-ap-south-1.pooler.supabase.com";
  const prod = (port: string | undefined, host = POOLER) => ({
    NODE_ENV: "production",
    SUPABASE_DB_HOST: host,
    SUPABASE_DB_PORT: port,
    SUPABASE_DB_USER: "postgres.secretref",
    SUPABASE_DB_PASSWORD: "s3cret-password",
  });

  it("recognises pooler hosts on label boundaries only", () => {
    for (const h of [POOLER, "AWS-0-EU-CENTRAL-1.POOLER.SUPABASE.COM", `${POOLER}.`, "pooler.supabase.com"]) {
      expect(isSupabasePoolerHost(h), h).toBe(true);
    }
    for (const h of [
      undefined,
      "",
      "evilpooler.supabase.com",
      "pooler.supabase.com.example.net",
      "aws-1-ap-south-1.pooler.supabase.co",
      "db.abcdefgh.supabase.co",
      "127.0.0.1",
      "localhost",
      `${POOLER}:5432`,
      `user@${POOLER}`,
      "aws_1.pooler.supabase.com",
      "-x.pooler.supabase.com",
    ]) {
      expect(isSupabasePoolerHost(h), String(h)).toBe(false);
    }
  });

  it("production + pooler: 5432 and 6543 pass, an unset port means the default 5432", () => {
    expect(checkSupabaseDbTarget(prod("5432"))).toEqual({ ok: true });
    expect(checkSupabaseDbTarget(prod("6543"))).toEqual({ ok: true });
    expect(checkSupabaseDbTarget(prod(undefined))).toEqual({ ok: true });
    expect(checkSupabaseDbTarget(prod(""))).toEqual({ ok: true });
    expect(supabaseDbPort(prod("6543"))).toBe(6543);
    expect(supabaseDbPort(prod(undefined))).toBe(5432);
  });

  it("production + pooler: 54322 (the incident) and every other port fail, naming the cause", () => {
    const r = checkSupabaseDbTarget(prod("54322"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.class).toBe("format");
    expect(!r.ok && r.reason).toMatch(/SUPABASE_DB_PORT=54322 .*5432 \(session pooler\) or 6543 \(transaction pooler\).*LOCAL/);
    for (const p of ["5433", "6542", "0", "65536", "abc", "5432x", "-5432"]) {
      expect(checkSupabaseDbTarget(prod(p)).ok, p).toBe(false);
    }
  });

  it("supabaseDbPort throws DbConfigError whose message carries no host, user, password or connection string", () => {
    const env = prod("54322");
    expect(() => supabaseDbPort(env)).toThrow(DbConfigError);
    try {
      supabaseDbPort(env);
    } catch (e) {
      const msg = (e as Error).message;
      expect((e as DbConfigError).code).toBe("DB_CONFIG_INVALID");
      expect(msg).toMatch(/^invalid database configuration: SUPABASE_DB_PORT=54322/);
      for (const secret of [env.SUPABASE_DB_HOST, env.SUPABASE_DB_USER, env.SUPABASE_DB_PASSWORD, "postgres://", "postgresql://"]) {
        expect(msg).not.toContain(secret);
      }
    }
  });

  it("development, test and non-pooler hosts keep the existing behaviour — 54322 included", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(supabaseDbPort({ ...prod("54322"), NODE_ENV }), String(NODE_ENV)).toBe(54322);
    }
    expect(supabaseDbPort(prod("54322", "127.0.0.1"))).toBe(54322);
    expect(supabaseDbPort(prod("54322", "pooler.supabase.com.example.net"))).toBe(54322);
    expect(supabaseDbPort({})).toBe(5432);
    expect(supabaseDbPort({ SUPABASE_DB_PORT: "" })).toBe(5432);
  });

  // Regression: the rule trimmed the value but the port returned did not
  // (Number("   " || 5432) === 0). Both now use the same normalised value.
  it("whitespace around SUPABASE_DB_PORT is normalised ONCE: the rule and the returned port agree", () => {
    for (const NODE_ENV of ["production", "development"]) {
      const env = (port: string) => ({ ...prod(port), NODE_ENV });
      expect(checkSupabaseDbTarget(env("   ")), `${NODE_ENV} blank`).toEqual({ ok: true });
      expect(supabaseDbPort(env("   ")), `${NODE_ENV} blank`).toBe(5432);
      expect(supabaseDbPort(env(" \t6543\n")), `${NODE_ENV} padded 6543`).toBe(6543);
    }
    const padded = checkSupabaseDbTarget(prod(" \t54322\n"));
    expect(!padded.ok && padded.reason).toMatch(/SUPABASE_DB_PORT=54322 /);
    expect(() => supabaseDbPort(prod(" 54322 "))).toThrow(DbConfigError);
    expect(supabaseDbPort({ ...prod(" 54322 "), NODE_ENV: "development" })).toBe(54322);
  });

  it("probeSupabaseDb: NODE_ENV in the given map cannot switch the production rule off — it can only switch it on", async () => {
    pg.clients = 0;
    const target = { SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: "54322", SUPABASE_DB_NAME: "postgres", SUPABASE_DB_USER: "u", SUPABASE_DB_PASSWORD: "p" };
    vi.stubEnv("NODE_ENV", "production");
    try {
      for (const NODE_ENV of ["development", "test", ""]) {
        expect(await probeSupabaseDb({ ...target, NODE_ENV }), NODE_ENV).toMatchObject({ ok: false, class: "format" });
      }
      expect(await probeSupabaseDb(target)).toMatchObject({ ok: false, class: "format" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(pg.clients).toBe(0);
    // A non-production process with a map that says production: the rule applies.
    expect(await probeSupabaseDb({ ...target, NODE_ENV: "production" })).toMatchObject({ ok: false, class: "format" });
    expect(pg.clients).toBe(0);
  });

  it("probeSupabaseDb connects to the same normalised port the rule judged", async () => {
    pg.clients = 0;
    pg.ports.length = 0;
    const env = { SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: " 6543 ", SUPABASE_DB_NAME: "postgres", SUPABASE_DB_USER: "u", SUPABASE_DB_PASSWORD: "p", NODE_ENV: "production" };
    expect(await probeSupabaseDb(env)).toMatchObject({ ok: false, class: "network" });
    expect(await probeSupabaseDb({ ...env, SUPABASE_DB_PORT: "   " })).toMatchObject({ ok: false, class: "network" });
    expect(pg.ports).toEqual([6543, 5432]);
  });

  it("probeSupabaseDb refuses the target without opening a connection; a valid target still reaches the live probe", async () => {
    pg.clients = 0;
    const base = { SUPABASE_DB_NAME: "postgres", SUPABASE_DB_USER: "u", SUPABASE_DB_PASSWORD: "p" };
    const refused = await probeSupabaseDb({ ...base, NODE_ENV: "production", SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: "54322" });
    expect(refused).toMatchObject({ ok: false, class: "format" });
    expect(pg.clients).toBe(0);
    const live = await probeSupabaseDb({ ...base, NODE_ENV: "production", SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: "5432" });
    expect(live).toMatchObject({ ok: false, class: "network" }); // the mocked transport, not the config rule
    expect(pg.clients).toBe(1);
  });

  // Every connection built from SUPABASE_DB_HOST must take its port through the
  // one rule. A new site that reads SUPABASE_DB_PORT itself fails here.
  it("every source connection site takes its port through supabaseDbPort", () => {
    const ROOT = process.cwd();
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = join(dir, e.name);
        if (e.isDirectory()) return walk(rel);
        return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
      });
    const notSites = new Set(["src/lib/relocation/env-validation.ts", "src/lib/outreach/test-db-guard.ts"]);
    const sites = [...walk("src"), ...walk("worker")]
      .filter((f) => !notSites.has(f))
      .map((f) => ({ f, text: readFileSync(join(ROOT, f), "utf8") }))
      .filter(({ text }) => text.includes("SUPABASE_DB_HOST"));
    expect(sites.map((s) => s.f).sort()).toEqual(
      ["src/lib/owner-agent/consumer/main.ts", "src/lib/queue/web-sender.ts", "worker/main.ts"].sort(),
    );
    for (const { f, text } of sites) {
      const hosts = text.match(/host:\s*(?:process\.)?env\.SUPABASE_DB_HOST/g)?.length ?? 0;
      const ports = text.match(/port:\s*supabaseDbPort\((?:process\.)?env\)/g)?.length ?? 0;
      expect({ f, hosts, ports, rawPort: /SUPABASE_DB_PORT/.test(text) }).toEqual({ f, hosts, ports: hosts, rawPort: false });
      expect(hosts, f).toBeGreaterThan(0);
    }
  });
});
