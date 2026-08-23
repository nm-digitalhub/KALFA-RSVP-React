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

describe("buildStepDefinitions (relocation, 19 steps)", () => {
  const defs = buildStepDefinitions();

  it("covers the full plan §5 sequence with unique ids", () => {
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "B1", "C1", "C2", "C3", "C4", "D0", "D1", "D2", "D3", "E1",
      "F1", "F2", "F3", "F4", "F5", "F6", "F7", "G1", "H1",
    ]);
  });

  it("gated steps carry the correct owner-approval gate", () => {
    const gated = Object.fromEntries(defs.map((d) => [d.id, d.gate ?? null]));
    expect(gated.B1).toBe("meta-template-submit");
    expect(gated.C1).toBe("go-live");
    expect(gated.F6).toBe("voximplant-scenario-redeploy");
  });

  it("no wired apply() mutates without RELOCATE_EXECUTE=1 (B1/F5/F6 stay manual regardless)", async () => {
    expect(process.env.RELOCATE_EXECUTE).toBeUndefined(); // ambient safety
    // B1/F5/F6: no execution module wires these yet (owner-gated/manual by
    // design). C4: check() always returns 'done' (its verify runs nginx -t
    // via C3) so the engine never calls its apply() in a real run — the
    // default step() fallback (NotImplementedError) is the correct no-op.
    const alwaysManual = new Set(["B1", "C4", "F5", "F6"]);
    const noopVerifyOnly = new Set(["H1"]); // apply() has nothing to mutate
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
    expect(allSteps).toHaveLength(19);
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
  });
});
