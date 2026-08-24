import { describe, expect, it } from "vitest";

import { ExecuteLatchError } from "./exec";
import { NotImplementedError, initState, runSteps, type WizardContext } from "./engine";
import { buildStepDefinitions } from "./steps";

const ctx: WizardContext = {
  repoRoot: "/repo",
  targetOrigin: "https://new.example",
  previousOrigin: "https://old.example",
  mode: "dry-run",
};

const EXPECTED_IDS = [
  "B1", "B2", "C1", "C2", "C3", "C4", "D0", "D1", "D2", "D3", "E1",
  "F1", "F2", "F3", "F4", "F5", "F6", "F6b", "F7", "F8", "F9", "G1", "G2", "H1",
];

describe(`buildStepDefinitions (relocation, ${EXPECTED_IDS.length} steps)`, () => {
  const defs = buildStepDefinitions();

  it("covers the full plan §5 sequence with unique ids", () => {
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(EXPECTED_IDS);
  });

  it("gated steps carry the correct owner-approval gate", () => {
    const gated = Object.fromEntries(defs.map((d) => [d.id, d.gate ?? null]));
    expect(gated.B1).toBe("meta-template-submit");
    expect(gated.B2).toBe("meta-approval-override");
    expect(gated.C1).toBe("go-live");
    expect(gated.F6).toBe("voximplant-scenario-redeploy");
    expect(gated.F6b).toBe("voximplant-scenario-redeploy");
    expect(gated.F8).toBe("elevenlabs-live-update");
    expect(gated.F9).toBe("elevenlabs-live-update");
    // Ungated by design: F5 re-arms the SAME callback token (no new secret,
    // no DB write); G2 only ever switches to templates Meta already approved.
    expect(gated.F5).toBeNull();
    expect(gated.G2).toBeNull();
  });

  it("the Voximplant secret precedes the (conditional) scenario upload — scenarios fail closed without it", () => {
    const ids = defs.map((d) => d.id);
    expect(ids.indexOf("F6")).toBeLessThan(ids.indexOf("F6b"));
    // and Meta approval waiting sits between submission and the DB switch
    expect(ids.indexOf("B1")).toBeLessThan(ids.indexOf("B2"));
    expect(ids.indexOf("B2")).toBeLessThan(ids.indexOf("G2"));
  });

  it("no wired apply() mutates without RELOCATE_EXECUTE=1 (every external step is latched first)", async () => {
    expect(process.env.RELOCATE_EXECUTE).toBeUndefined(); // ambient safety
    // C4: check() always returns 'done' (its verify runs nginx -t via C3) so
    // the engine never calls its apply() in a real run — the default step()
    // fallback (NotImplementedError) is the correct no-op.
    const alwaysManual = new Set(["C4"]);
    // B2 is a decision gate (nothing to mutate); H1 is verify-only.
    const noopVerifyOnly = new Set(["B2", "H1"]);
    for (const def of defs) {
      if (alwaysManual.has(def.id)) {
        await expect(def.apply(ctx), def.id).rejects.toBeInstanceOf(NotImplementedError);
      } else if (noopVerifyOnly.has(def.id)) {
        await expect(def.apply(ctx), def.id).resolves.toBeUndefined();
      } else {
        await expect(def.apply(ctx), def.id).rejects.toBeInstanceOf(ExecuteLatchError);
      }
    }
  });

  it("REGRESSION GUARD: the full step list still dry-runs cleanly (real code, no execution) and produces plan lines for every step", async () => {
    const state = initState({
      runId: "test",
      targetOrigin: ctx.targetOrigin,
      previousOrigin: ctx.previousOrigin,
      mode: "dry-run",
      flavor: "relocate",
      defs,
    });
    const outcome = await runSteps({
      defs,
      ctx,
      state,
      repoRoot: ctx.repoRoot,
      dryRun: true,
      persist: () => undefined, // no disk writes from this test
    });
    expect(outcome).toEqual({ outcome: "dry-run" });
    const allSteps = state.stages.flatMap((s) => s.steps);
    expect(allSteps).toHaveLength(EXPECTED_IDS.length);
    for (const step of allSteps) {
      expect(step.planLines?.length ?? 0, step.id).toBeGreaterThan(0);
    }
    // Nothing touched disk/network in dry-run — every step is still 'pending'
    // (the engine never calls check()/apply() in the dry-run branch).
    expect(allSteps.every((s) => s.status === "pending")).toBe(true);
  });

  it("plan lines carry the live-verified commands and the RELOCATE_EXECUTE-latched module names", async () => {
    const all = (await Promise.all(defs.map((d) => d.plan(ctx)))).flat().join("\n");
    expect(all).toContain("plesk bin domain --create");
    expect(all).toContain("Let's Encrypt cert");
    expect(all).toContain("proxy buffers");
    expect(all).toContain("npm run deploy");
    expect(all).toContain("pm2 delete kalfa-fleet");
    expect(all).toContain("location / → 301");
    expect(all).toContain("config/auth");
    expect(all).toContain("deploy-recovery-email-template.mjs");
    expect(all).toContain("/subscriptions");
    expect(all).toContain("dataStreams.patch");
    expect(all).toContain("UPDATE app_settings");
    // the gaps closed 2026-08-24
    expect(all).toContain("POST /{waba}/message_templates");
    expect(all).toContain("meta-approval-override");
    expect(all).toContain("SetAccountInfo");
    expect(all).toContain("AddSecret / SetSecretInfo KALFA_APP_ORIGIN");
    expect(all).toContain("npm run vox:upload -- --rule-name");
    expect(all).toContain("1494311"); // the DTMF rule is named so it is never touched
    expect(all).toContain("/v1/convai/tools");
    expect(all).toContain("elevenlabs agents pull");
    expect(all).toContain("elevenlabs agents push");
    expect(all).toContain("UPDATE message_templates");
    expect(all).toContain("/r/<guest>");
  });
});
