import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExecuteLatchError } from "./exec";
import {
  APP_ORIGIN_SECRET_NAME,
  CONSOLE_SCENARIOS,
  ensureAppSecret,
  rearmAccountCallback,
  rebaseCallbackUrl,
  resolveScenarioIds,
  resolveVoxApplicationId,
  scenarioCodeMentionsHost,
  scenarioReadsOriginSecret,
  uploadConsoleScenarios,
} from "./voximplant-relocate";

const repoRoot = join(__dirname, "..", "..", "..");

describe("console scenario sources (Phase 0 #4/#4b — origin from the application secret)", () => {
  for (const { scenario } of CONSOLE_SCENARIOS) {
    it(`${scenario}.voxengine.js reads ${APP_ORIGIN_SECRET_NAME} and pins no origin literal in code`, () => {
      const src = readFileSync(join(repoRoot, "voxfiles", "scenarios", "src", `${scenario}.voxengine.js`), "utf8");
      expect(src).toContain(`VoxEngine.getSecretValue('${APP_ORIGIN_SECRET_NAME}')`);
      expect(scenarioCodeMentionsHost(src, "beta.kalfa.me")).toBe(false);
      expect(scenarioReadsOriginSecret(src, "beta.kalfa.me")).toBe(true);
    });
  }

  it("the parity predicate ignores comment-only mentions but catches a code literal", () => {
    const ok = `// history: https://old.example\nvar X = VoxEngine.getSecretValue('${APP_ORIGIN_SECRET_NAME}');`;
    const bad = `var X = VoxEngine.getSecretValue('${APP_ORIGIN_SECRET_NAME}');\nvar Y = 'https://old.example/x';`;
    const missing = "var X = 'https://old.example';";
    expect(scenarioReadsOriginSecret(ok, "old.example")).toBe(true);
    expect(scenarioReadsOriginSecret(bad, "old.example")).toBe(false);
    expect(scenarioReadsOriginSecret(missing, "old.example")).toBe(false);
  });

  it("the console rule list never includes the DTMF OutCall rule or an agent rule", () => {
    const rules = CONSOLE_SCENARIOS.map((c) => c.rule);
    expect(rules).toEqual(["incoming", "ConsoleInternal", "ConsoleCallMeNow"]);
    expect(rules).not.toContain("OutCall");
    expect(rules).not.toContain("OutCallAgent");
  });
});

describe("voxengine-ci metadata resolution (never hardcoded ids)", () => {
  it("finds the production application id and the three console scenario ids from the repo metadata", () => {
    expect(resolveVoxApplicationId(repoRoot)).toBe(11107202);
    const ids = resolveScenarioIds(repoRoot);
    expect(Object.keys(ids).sort()).toEqual(["ConsoleCallMeNow", "ConsoleDial", "ConsoleInbound"]);
    for (const id of Object.values(ids)) expect(id).toBeGreaterThan(0);
  });

  it("returns null / empty on a directory without metadata", () => {
    expect(resolveVoxApplicationId("/nonexistent")).toBeNull();
    expect(resolveScenarioIds("/nonexistent")).toEqual({});
  });
});

describe("rebaseCallbackUrl", () => {
  it("keeps the token path, swaps the origin", () => {
    expect(rebaseCallbackUrl("https://old.example/api/voximplant/account-callback/abc123", "https://new.example")).toBe(
      "https://new.example/api/voximplant/account-callback/abc123",
    );
    expect(rebaseCallbackUrl("not a url", "https://new.example")).toBeNull();
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
  });
  const cfg = { accountId: 1, keyId: "k", privateKey: "p" };

  it("every mutating helper refuses without RELOCATE_EXECUTE=1", async () => {
    await expect(ensureAppSecret(cfg, 1, APP_ORIGIN_SECRET_NAME, "https://x")).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(rearmAccountCallback(cfg, "https://x", "salt")).rejects.toBeInstanceOf(ExecuteLatchError);
    await expect(uploadConsoleScenarios("/repo", ["ConsoleDial"])).rejects.toBeInstanceOf(ExecuteLatchError);
  });
});
