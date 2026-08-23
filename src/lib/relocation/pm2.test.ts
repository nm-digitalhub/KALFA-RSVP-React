import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exec")>();
  return { ...actual, runCommand: vi.fn() };
});

import { ExecuteLatchError, runCommand } from "./exec";
import {
  cleanRestartFleet,
  cleanRestartFleetPlan,
  deploy,
  deployArgv,
  findPm2Id,
  parsePm2Env,
  pm2Env,
  restartApp,
  restartAppArgv,
} from "./pm2";

const mockedRun = vi.mocked(runCommand);
const okResult = { ok: true, code: 0, stdout: "", stderr: "", command: "" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("argv builders (the D.1 matrix, pinned)", () => {
  it("restartApp restarts exactly the .env-at-boot processes, plainly", () => {
    expect(restartAppArgv()).toEqual(["pm2", "restart", "kalfa-beta", "kalfa-worker", "kalfa-ops-agent"]);
  });

  it("cleanRestartFleet is delete → scrubbed start → save, in that order", () => {
    const plan = cleanRestartFleetPlan("/home/app", "appuser");
    expect(plan).toEqual([
      ["pm2", "delete", "kalfa-fleet"],
      [
        "env",
        "-i",
        "HOME=/home/app",
        "USER=appuser",
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "pm2",
        "start",
        "ecosystem.config.cjs",
        "--only",
        "kalfa-fleet",
      ],
      ["pm2", "save"],
    ]);
  });

  it("NEVER uses --update-env anywhere (the 2026-07-06 env-pollution incident)", () => {
    const everything = JSON.stringify([
      restartAppArgv(),
      cleanRestartFleetPlan("/h", "u"),
      deployArgv(),
    ]);
    expect(everything).not.toContain("--update-env");
  });
});

describe("execute latch", () => {
  it("all mutators refuse without RELOCATE_EXECUTE=1", async () => {
    vi.stubEnv("RELOCATE_EXECUTE", "");
    await expect(restartApp()).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(
      cleanRestartFleet({ repoRoot: "/r", home: "/h", user: "u" }),
    ).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(deploy("/r")).rejects.toBeInstanceOf(ExecuteLatchError);
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("mutators with the latch on", () => {
  it("cleanRestartFleet runs the plan from the repo root and stops on first failure", async () => {
    vi.stubEnv("RELOCATE_EXECUTE", "1");
    mockedRun
      .mockResolvedValueOnce(okResult) // delete
      .mockResolvedValueOnce({ ...okResult, ok: false, code: 1 }); // scrubbed start fails
    const results = await cleanRestartFleet({ repoRoot: "/repo", home: "/h", user: "u" });
    expect(results).toHaveLength(2); // pm2 save NOT reached — broken state never saved
    const calls = mockedRun.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ cmd: "pm2", args: ["delete", "kalfa-fleet"], cwd: "/repo" });
    expect(calls[1]?.cmd).toBe("env");
  });

  it("deploy streams npm run deploy from the repo root with a long timeout", async () => {
    vi.stubEnv("RELOCATE_EXECUTE", "1");
    mockedRun.mockResolvedValue(okResult);
    const onOutput = vi.fn();
    await deploy("/repo", onOutput);
    expect(mockedRun).toHaveBeenCalledWith({
      cmd: "npm",
      args: ["run", "deploy"],
      cwd: "/repo",
      timeoutMs: 15 * 60_000,
      onOutput,
    });
  });
});

describe("pm2Env (read-only — no latch)", () => {
  it("resolves the pm_id from jlist and parses the env output", async () => {
    mockedRun
      .mockResolvedValueOnce({
        ...okResult,
        stdout: JSON.stringify([
          { name: "kalfa-beta", pm_id: 0 },
          { name: "kalfa-fleet", pm_id: 4 },
        ]),
      })
      .mockResolvedValueOnce({
        ...okResult,
        stdout: "APP_ORIGIN: https://new.example\nTZ: Asia/Jerusalem\n",
      });
    const env = await pm2Env("kalfa-fleet");
    expect(env).toEqual({ APP_ORIGIN: "https://new.example", TZ: "Asia/Jerusalem" });
    expect(mockedRun.mock.calls[1]?.[0]).toMatchObject({ cmd: "pm2", args: ["env", "4"] });
  });

  it("returns null for an unknown process", async () => {
    mockedRun.mockResolvedValueOnce({ ...okResult, stdout: "[]" });
    expect(await pm2Env("nope")).toBeNull();
  });
});

describe("pure parsers", () => {
  it("parsePm2Env reads KEY: value lines and ignores noise", () => {
    expect(parsePm2Env("APP_ORIGIN: https://x\nnot a pair\nPATH: /usr/bin\n")).toEqual({
      APP_ORIGIN: "https://x",
      PATH: "/usr/bin",
    });
  });

  it("findPm2Id tolerates malformed jlist output", () => {
    expect(findPm2Id("not json", "kalfa-beta")).toBeNull();
    expect(findPm2Id(JSON.stringify([{ name: "kalfa-beta", pm_id: 7 }]), "kalfa-beta")).toBe(7);
  });
});
