import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ExecuteLatchError,
  assertExecuteLatch,
  backupFile,
  backupStamp,
  buildArgv,
  describeCommand,
  runCommand,
  writeFileWithBackup,
} from "./exec";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildArgv", () => {
  it("prepends sudo -n only when asked and not already root", () => {
    expect(buildArgv({ cmd: "nginx", args: ["-t"], sudo: true })).toEqual({
      file: "sudo",
      args: ["-n", "nginx", "-t"],
    });
    expect(buildArgv({ cmd: "nginx", args: ["-t"] })).toEqual({
      file: "nginx",
      args: ["-t"],
    });
  });

  it("skips sudo when already running as root", () => {
    vi.spyOn(process, "getuid").mockReturnValue(0);
    expect(buildArgv({ cmd: "nginx", args: ["-t"], sudo: true })).toEqual({
      file: "nginx",
      args: ["-t"],
    });
  });
});

describe("describeCommand", () => {
  it("elides redacted argument values everywhere they could leak", () => {
    const rendered = describeCommand({
      cmd: "some-cli",
      args: ["--token", "sbp_secret_value", "--safe", "x"],
      redactArgs: [1],
    });
    expect(rendered).toContain("<redacted>");
    expect(rendered).not.toContain("sbp_secret_value");
    expect(rendered).toContain("--safe x");
  });
});

describe("assertExecuteLatch", () => {
  it("refuses without RELOCATE_EXECUTE=1 and passes with it", () => {
    vi.stubEnv("RELOCATE_EXECUTE", "");
    expect(() => assertExecuteLatch("test-op")).toThrow(ExecuteLatchError);
    vi.stubEnv("RELOCATE_EXECUTE", "1");
    expect(() => assertExecuteLatch("test-op")).not.toThrow();
  });
});

describe("runCommand (real, read-only node invocation)", () => {
  it("captures exit code, stdout, stdin round-trip, and streams output", async () => {
    const chunks: string[] = [];
    const res = await runCommand({
      cmd: process.execPath,
      args: ["-e", "process.stdin.on('data', d => process.stdout.write('got:' + d))"],
      input: "ping",
      onOutput: (c) => chunks.push(c),
    });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("got:ping");
    expect(chunks.join("")).toBe("got:ping");
  });

  it("reports a failing command without throwing", async () => {
    const res = await runCommand({
      cmd: process.execPath,
      args: ["-e", "process.exit(3)"],
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(3);
  });
});

describe("file primitives", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("backupFile copies beside the original with the repo's stamp convention", () => {
    const d = mkdtempSync(join(tmpdir(), "relocate-exec-"));
    dir = d;
    const file = join(d, "a.conf");
    writeFileSync(file, "original");
    const { backupPath } = backupFile(file);
    expect(backupPath).toMatch(/a\.conf\.bak-\d{8}-\d{6}$/);
    expect(readFileSync(backupPath, "utf8")).toBe("original");
  });

  it("backupFile throws on a missing target instead of skipping silently", () => {
    const d = mkdtempSync(join(tmpdir(), "relocate-exec-"));
    dir = d;
    expect(() => backupFile(join(d, "missing"))).toThrow(/does not exist/);
  });

  it("writeFileWithBackup preserves the existing mode and backs up first", () => {
    const d = mkdtempSync(join(tmpdir(), "relocate-exec-"));
    dir = d;
    const file = join(d, ".env.local");
    writeFileSync(file, "OLD=1\n", { mode: 0o640 });
    const { backup } = writeFileWithBackup(file, "NEW=2\n");
    expect(readFileSync(file, "utf8")).toBe("NEW=2\n");
    expect(backup).not.toBeNull();
    expect(readFileSync(backup!.backupPath, "utf8")).toBe("OLD=1\n");
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  it("writeFileWithBackup on a new file defaults to 0600 with no backup", () => {
    const d = mkdtempSync(join(tmpdir(), "relocate-exec-"));
    dir = d;
    const file = join(d, "fresh");
    const { backup } = writeFileWithBackup(file, "x");
    expect(backup).toBeNull();
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("backupStamp is filename-safe and second-precise", () => {
    expect(backupStamp(new Date("2026-08-23T14:05:09"))).toBe("20260823-140509");
  });
});
