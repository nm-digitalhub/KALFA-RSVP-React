import { describe, expect, it } from "vitest";

import {
  confServesHost,
  ipsOverlap,
  parseEnvFile,
  scanEnv,
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
});

describe("ipsOverlap", () => {
  it("detects any shared address", () => {
    expect(ipsOverlap(["1.2.3.4", "::1"], ["5.6.7.8", "1.2.3.4"])).toBe(true);
    expect(ipsOverlap(["1.2.3.4"], ["5.6.7.8"])).toBe(false);
    expect(ipsOverlap([], ["5.6.7.8"])).toBe(false);
  });
});
