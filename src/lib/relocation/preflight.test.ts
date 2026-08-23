import { describe, expect, it } from "vitest";

import {
  classifyLiveSite,
  confServesHost,
  ipsOverlap,
  parseEnvFile,
  scanEnv,
  summarizeTooling,
  validateTargetOrigin,
} from "./preflight";

const CURRENT = "https://current.example";

describe("validateTargetOrigin", () => {
  it("accepts a bare https origin, with or without an explicit port", () => {
    expect(validateTargetOrigin("https://new.example", CURRENT)).toMatchObject({
      ok: true,
      origin: "https://new.example",
      host: "new.example",
    });
    expect(validateTargetOrigin("  https://new.example/  ", CURRENT)).toMatchObject({ ok: true });
    expect(validateTargetOrigin("https://staging.example:8443", CURRENT)).toMatchObject({
      ok: true,
      origin: "https://staging.example:8443",
    });
  });

  it("rejects http, paths, queries, fragments, credentials, garbage, and the current origin", () => {
    const cases = [
      "http://new.example",
      "https://new.example/app",
      "https://new.example/?x=1",
      "https://new.example/#frag",
      "https://user:pass@new.example",
      "not a url",
      "",
      CURRENT,
    ];
    for (const raw of cases) {
      expect(validateTargetOrigin(raw, CURRENT).ok, raw).toBe(false);
    }
  });
});

describe("parseEnvFile", () => {
  it("parses KEY=VALUE, strips quotes, skips comments and malformed lines", () => {
    const parsed = parseEnvFile(
      [
        "# comment",
        "PLAIN=one",
        'QUOTED="two words"',
        "SINGLE='three'",
        "  SPACED = four ",
        "=nokey",
        "123BAD=x",
        "EMPTY=",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      PLAIN: "one",
      QUOTED: "two words",
      SINGLE: "three",
      SPACED: "four",
      EMPTY: "",
    });
  });
});

describe("scanEnv", () => {
  it("reports NEXT_PUBLIC_* keys embedding the origin host by NAME only", () => {
    const scan = scanEnv(
      {
        APP_ORIGIN: "https://current.example",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_BAD: "https://current.example/widget",
        PGBOSS_DASHBOARD_URL: "https://current.example/admin/jobs",
      },
      "current.example",
    );
    expect(scan.hasAppOrigin).toBe(true);
    expect(scan.nextPublicWithOrigin).toEqual(["NEXT_PUBLIC_BAD"]);
    expect(scan.pgbossDashboardHasOrigin).toBe(true);
  });

  it("reads the Supabase token presence from the provided map, never its value", () => {
    const withToken = scanEnv({ SUPABASE_ACCESS_TOKEN: "sbp_x" }, "h");
    expect(withToken.supabaseTokenPresent).toBe(true);
    const scanned = JSON.stringify(withToken);
    expect(scanned).not.toContain("sbp_x");
  });
});

describe("confServesHost", () => {
  it("matches the host inside server_name directives, not substrings", () => {
    expect(confServesHost("server_name new.example;", "new.example")).toBe(true);
    expect(confServesHost("server_name www.new.example new.example;", "new.example")).toBe(true);
    expect(confServesHost("server_name other.example;", "new.example")).toBe(false);
    expect(confServesHost("server_name notnew.example;", "new.example")).toBe(false);
    expect(confServesHost("proxy_pass https://new.example;", "new.example")).toBe(false);
  });

  it("matches Plesk's quoted server_name form (live regression, 2026-08-23)", () => {
    expect(confServesHost('server_name "new.example";', "new.example")).toBe(true);
    expect(confServesHost("server_name 'new.example';", "new.example")).toBe(true);
    expect(confServesHost('server_name "www.new.example";', "new.example")).toBe(false);
    expect(confServesHost('server_name "notnew.example";', "new.example")).toBe(false);
  });
});

describe("ipsOverlap", () => {
  it("detects any shared address", () => {
    expect(ipsOverlap(["1.2.3.4", "::1"], ["5.6.7.8", "1.2.3.4"])).toBe(true);
    expect(ipsOverlap(["1.2.3.4"], ["5.6.7.8"])).toBe(false);
    expect(ipsOverlap([], ["5.6.7.8"])).toBe(false);
  });
});

describe("summarizeTooling", () => {
  it("all present → ok with versions", () => {
    const f = summarizeTooling([
      { name: "nginx", ok: true, version: "nginx/1.24", fix: "x" },
      { name: "pm2", ok: true, version: "6.0.0", fix: "y" },
    ]);
    expect(f.status).toBe("ok");
    expect(f.detail).toContain("nginx/1.24");
  });

  it("anything missing → blocked, naming the tool AND the exact fix", () => {
    const f = summarizeTooling([
      { name: "nginx", ok: true, version: "nginx/1.24", fix: "x" },
      { name: "pm2", ok: false, fix: "npm install -g pm2" },
      { name: "node_modules", ok: false, fix: "npm ci (repo-local, safe)" },
    ]);
    expect(f.status).toBe("blocked");
    expect(f.detail).toContain("pm2 — fix: npm install -g pm2");
    expect(f.detail).toContain("node_modules — fix: npm ci");
  });
});

describe("classifyLiveSite", () => {
  const host = "shop.example";

  it("nothing answers → ok, with the probe's reason", () => {
    const f = classifyLiveSite({
      targetHost: host,
      pointsHere: false,
      probe: { answered: false, reason: "ECONNREFUSED" },
    });
    expect(f.status).toBe("ok");
    expect(f.detail).toContain("nothing live answers");
    expect(f.detail).toContain("ECONNREFUSED");
  });

  it("live site on ANOTHER server → decision naming the offline consequence", () => {
    const f = classifyLiveSite({
      targetHost: host,
      pointsHere: false,
      probe: { answered: true, status: 200, server: "cloudflare" },
    });
    expect(f.status).toBe("decision");
    expect(f.detail).toContain("ANOTHER server");
    expect(f.detail).toContain("HTTP 200");
    expect(f.detail).toContain("cloudflare");
    expect(f.detail).toContain("offline");
  });

  it("a TLS endpoint that rejects the handshake still counts as a live site", () => {
    const f = classifyLiveSite({
      targetHost: host,
      pointsHere: false,
      probe: { answered: true, tlsError: true },
    });
    expect(f.status).toBe("decision");
    expect(f.detail).toContain("TLS endpoint answers");
  });

  it("answers from THIS server → open, deferring to the vhost conflict check", () => {
    const f = classifyLiveSite({
      targetHost: host,
      pointsHere: true,
      probe: { answered: true, status: 200, server: "nginx" },
    });
    expect(f.status).toBe("open");
    expect(f.detail).toContain("this server");
    expect(f.detail).toContain("conflict check");
  });
});
