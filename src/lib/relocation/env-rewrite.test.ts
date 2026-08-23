import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ExecuteLatchError } from "./exec";
import {
  rewriteEcosystemContent,
  rewriteEcosystemOrigin,
  rewriteEnvContent,
  rewriteOriginKeys,
} from "./env-rewrite";

const ENV_FIXTURE = [
  "# Supabase — public values",
  "NEXT_PUBLIC_SUPABASE_URL=https://proj.supabase.co",
  "",
  "APP_ORIGIN=https://old.example   # inline comment survives",
  "PGBOSS_DASHBOARD_URL=https://old.example/admin/jobs?tab=queues",
  "TRAILING_SPACES=value   ",
  "# closing comment",
].join("\n");

afterEach(() => vi.unstubAllEnvs());

describe("rewriteEnvContent", () => {
  const { content, rewritten } = rewriteEnvContent(ENV_FIXTURE, "https://new.example");
  const lines = content.split("\n");

  it("rewrites exactly APP_ORIGIN and PGBOSS_DASHBOARD_URL", () => {
    expect(rewritten).toEqual(["APP_ORIGIN", "PGBOSS_DASHBOARD_URL"]);
    expect(lines[3]).toBe("APP_ORIGIN=https://new.example   # inline comment survives");
    expect(lines[4]).toBe("PGBOSS_DASHBOARD_URL=https://new.example/admin/jobs?tab=queues");
  });

  it("preserves every untouched line byte-for-byte, comments and spaces included", () => {
    const original = ENV_FIXTURE.split("\n");
    for (const i of [0, 1, 2, 5, 6]) {
      expect(lines[i]).toBe(original[i]);
    }
  });

  it("leaves an unparseable PGBOSS_DASHBOARD_URL untouched rather than guessing", () => {
    const res = rewriteEnvContent("PGBOSS_DASHBOARD_URL=not-a-url\n", "https://new.example");
    expect(res.content).toBe("PGBOSS_DASHBOARD_URL=not-a-url\n");
    expect(res.rewritten).toEqual([]);
  });
});

const ECOSYSTEM_FIXTURE = [
  "module.exports = {",
  "  apps: [",
  "    {",
  "      name: 'kalfa-fleet',",
  "      env: {",
  "        NODE_ENV: 'production',",
  "        // comment mentioning APP_ORIGIN stays untouched",
  "        APP_ORIGIN: 'https://old.example',",
  "        PATH: '/usr/local/bin:/usr/bin:/bin',",
  "      },",
  "    },",
  "  ],",
  "};",
].join("\n");

describe("rewriteEcosystemContent", () => {
  it("rewrites exactly the one inline APP_ORIGIN line", () => {
    const out = rewriteEcosystemContent(ECOSYSTEM_FIXTURE, "https://new.example");
    const changed = out
      .split("\n")
      .filter((l, i) => l !== ECOSYSTEM_FIXTURE.split("\n")[i]);
    expect(changed).toEqual(["        APP_ORIGIN: 'https://new.example',"]);
  });

  it("refuses on zero matches and on more than one (precision guarantee)", () => {
    expect(() => rewriteEcosystemContent("nothing here", "https://n")).toThrow(/found 0/);
    const doubled = `${ECOSYSTEM_FIXTURE}\n        APP_ORIGIN: 'https://other.example',`;
    expect(() => rewriteEcosystemContent(doubled, "https://n")).toThrow(/found 2/);
  });
});

describe("file wrappers", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("both wrappers refuse without the execute latch", () => {
    vi.stubEnv("RELOCATE_EXECUTE", "");
    expect(() => rewriteOriginKeys({ repoRoot: "/nowhere", newOrigin: "https://n" })).toThrow(
      ExecuteLatchError,
    );
    expect(() =>
      rewriteEcosystemOrigin({ repoRoot: "/nowhere", newOrigin: "https://n" }),
    ).toThrow(ExecuteLatchError);
  });

  it("rewriteOriginKeys backs up, rewrites, and preserves the file mode", () => {
    vi.stubEnv("RELOCATE_EXECUTE", "1");
    const d = mkdtempSync(join(tmpdir(), "relocate-envrw-"));
    dir = d;
    writeFileSync(join(d, ".env.local"), ENV_FIXTURE, { mode: 0o600 });
    const { backups, rewritten } = rewriteOriginKeys({ repoRoot: d, newOrigin: "https://new.example" });
    expect(rewritten).toContain("APP_ORIGIN");
    expect(backups).toHaveLength(1);
    expect(readFileSync(backups[0].backupPath, "utf8")).toBe(ENV_FIXTURE);
    expect(readFileSync(join(d, ".env.local"), "utf8")).toContain("APP_ORIGIN=https://new.example");
    expect(statSync(join(d, ".env.local")).mode & 0o777).toBe(0o600);
  });

  it("rewriteOriginKeys refuses an env file with no APP_ORIGIN line", () => {
    vi.stubEnv("RELOCATE_EXECUTE", "1");
    const d = mkdtempSync(join(tmpdir(), "relocate-envrw-"));
    dir = d;
    writeFileSync(join(d, ".env.local"), "OTHER=1\n");
    expect(() => rewriteOriginKeys({ repoRoot: d, newOrigin: "https://n" })).toThrow(
      /no APP_ORIGIN/,
    );
  });

  it("rewriteEcosystemOrigin rewrites the inline line on disk with a backup", () => {
    vi.stubEnv("RELOCATE_EXECUTE", "1");
    const d = mkdtempSync(join(tmpdir(), "relocate-envrw-"));
    dir = d;
    writeFileSync(join(d, "ecosystem.config.cjs"), ECOSYSTEM_FIXTURE);
    const { backups } = rewriteEcosystemOrigin({ repoRoot: d, newOrigin: "https://new.example" });
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(d, "ecosystem.config.cjs"), "utf8")).toContain(
      "APP_ORIGIN: 'https://new.example',",
    );
  });
});
