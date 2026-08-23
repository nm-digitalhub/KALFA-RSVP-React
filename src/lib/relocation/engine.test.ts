import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LockHeldError,
  acquireLock,
  initState,
  releaseLock,
  repairStep,
  rollbackRun,
  runSteps,
  sanitizeErrorMessage,
  type StepDefinition,
  type WizardContext,
} from "./engine";
import { RELOCATE_LOCK_FILE } from "./state";

const ctx: WizardContext = {
  repoRoot: "/tmp/unused",
  targetOrigin: "https://new.example",
  previousOrigin: "https://old.example",
  mode: "dry-run",
};

function makeDef(
  id: string,
  calls: string[],
  overrides: Partial<StepDefinition> = {},
): StepDefinition {
  return {
    id,
    stage: "C",
    label: { en: id, he: id },
    check: async () => "pending",
    plan: async () => [`plan line for ${id}`],
    apply: async () => {
      calls.push(`apply:${id}`);
    },
    verify: async () => ({ ok: true, checks: [] }),
    ...overrides,
  };
}

function setup(defs: StepDefinition[]) {
  const state = initState({
    runId: "t1",
    targetOrigin: ctx.targetOrigin,
    previousOrigin: ctx.previousOrigin,
    mode: "dry-run",
    defs,
  });
  const persisted: number[] = [];
  const persist = () => persisted.push(1);
  return { state, persist, persisted };
}

describe("runSteps", () => {
  it("dry-run collects plan lines and never applies", async () => {
    const calls: string[] = [];
    const defs = [makeDef("C1", calls), makeDef("C2", calls)];
    const { state, persist } = setup(defs);

    const outcome = await runSteps({ defs, ctx, state, repoRoot: "/nowhere", dryRun: true, persist, heartbeat: false });

    expect(outcome).toEqual({ outcome: "dry-run" });
    expect(calls).toEqual([]);
    const steps = state.stages.flatMap((s) => s.steps);
    expect(steps.map((s) => s.planLines)).toEqual([["plan line for C1"], ["plan line for C2"]]);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("a failed verify halts the run and leaves later steps untouched", async () => {
    const calls: string[] = [];
    const defs = [
      makeDef("C1", calls, { verify: async () => ({ ok: false, checks: [{ label: { en: "x", he: "x" }, ok: false }] }) }),
      makeDef("C2", calls),
    ];
    const { state, persist } = setup(defs);

    const outcome = await runSteps({ defs, ctx, state, repoRoot: "/nowhere", dryRun: false, persist, heartbeat: false });

    expect(outcome).toEqual({ outcome: "failed", stepId: "C1" });
    expect(calls).toEqual(["apply:C1"]);
    const [c1, c2] = state.stages.flatMap((s) => s.steps);
    expect(c1.status).toBe("failed");
    expect(c1.error?.message).toBeTruthy();
    expect(c2.status).toBe("pending");
    expect(state.phase).toBe("failed");
  });

  it("resume skips steps already done", async () => {
    const calls: string[] = [];
    const defs = [makeDef("C1", calls), makeDef("C2", calls)];
    const { state, persist } = setup(defs);
    state.stages[0].steps[0].status = "done";

    const outcome = await runSteps({ defs, ctx, state, repoRoot: "/nowhere", dryRun: false, persist, heartbeat: false });

    expect(outcome).toEqual({ outcome: "completed" });
    expect(calls).toEqual(["apply:C2"]);
  });

  it("an idempotency probe returning done marks the step done without applying", async () => {
    const calls: string[] = [];
    const defs = [makeDef("C1", calls, { check: async () => "done" })];
    const { state, persist } = setup(defs);

    const outcome = await runSteps({ defs, ctx, state, repoRoot: "/nowhere", dryRun: false, persist, heartbeat: false });

    expect(outcome).toEqual({ outcome: "completed" });
    expect(calls).toEqual([]);
    expect(state.stages[0].steps[0].status).toBe("done");
  });

  it("an unapproved gate halts with outcome gate and opens the gate", async () => {
    const calls: string[] = [];
    const defs = [makeDef("C1", calls, { gate: "go-live" })];
    const { state, persist } = setup(defs);

    const outcome = await runSteps({ defs, ctx, state, repoRoot: "/nowhere", dryRun: false, persist, heartbeat: false });

    expect(outcome).toEqual({ outcome: "gate", stepId: "C1", gateId: "go-live" });
    expect(calls).toEqual([]);
    expect(state.gates.find((g) => g.id === "go-live")?.status).toBe("open");
  });

  it("an approved gate lets the step run", async () => {
    const calls: string[] = [];
    const defs = [makeDef("C1", calls, { gate: "go-live" })];
    const { state, persist } = setup(defs);
    state.gates.find((g) => g.id === "go-live")!.status = "approved";

    const outcome = await runSteps({ defs, ctx, state, repoRoot: "/nowhere", dryRun: false, persist, heartbeat: false });

    expect(outcome).toEqual({ outcome: "completed" });
    expect(calls).toEqual(["apply:C1"]);
  });
});

describe("rollbackRun", () => {
  it("walks done/failed steps in reverse order and records the history", async () => {
    const rolledBack: string[] = [];
    const calls: string[] = [];
    const defs = ["C1", "C2", "C3"].map((id) =>
      makeDef(id, calls, {
        rollback: async () => {
          rolledBack.push(id);
        },
      }),
    );
    const { state, persist } = setup(defs);
    const [c1, c2, c3] = state.stages.flatMap((s) => s.steps);
    c1.status = "done";
    c2.status = "failed";
    c3.status = "pending";

    await rollbackRun({ defs, ctx, state, repoRoot: "/nowhere", persist });

    expect(rolledBack).toEqual(["C2", "C1"]);
    expect(state.rollbacks.map((r) => r.stepId)).toEqual(["C2", "C1"]);
    expect(c1.status).toBe("rolled-back");
    expect(c2.status).toBe("rolled-back");
    expect(c3.status).toBe("pending");
    expect(state.phase).toBe("aborted");
  });
});

describe("repairStep", () => {
  it("marks a step done or resets it to pending", () => {
    const calls: string[] = [];
    const defs = [makeDef("C1", calls)];
    const { state } = setup(defs);
    const step = state.stages[0].steps[0];
    step.status = "failed";
    step.error = { message: "boom", logPath: "/x" };

    expect(repairStep(state, "C1", "done").status).toBe("done");
    expect(repairStep(state, "C1", "pending").status).toBe("pending");
    expect(step.error).toBeUndefined();
    expect(() => repairStep(state, "nope", "done")).toThrow(/unknown step/);
  });
});

describe("sanitizeErrorMessage", () => {
  it("keeps one line and elides absolute paths", () => {
    const message = sanitizeErrorMessage(
      new Error("EACCES: permission denied, open /etc/nginx/conf.d/x.conf\nstack line"),
    );
    expect(message).not.toContain("\n");
    expect(message).not.toContain("/etc/nginx");
    expect(message).toContain("<path>");
  });
});

describe("lock", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses when another live process holds the lock, reclaims stale locks", () => {
    dir = mkdtempSync(join(tmpdir(), "relocate-lock-"));
    acquireLock(dir);
    // pid 1 is always alive (kill 0 → EPERM for us) — a live foreign holder.
    writeFileSync(join(dir, RELOCATE_LOCK_FILE), JSON.stringify({ pid: 1, startedAt: "x" }));
    expect(() => acquireLock(dir)).toThrow(LockHeldError);
    // A dead pid is stale — reclaimed silently.
    writeFileSync(join(dir, RELOCATE_LOCK_FILE), JSON.stringify({ pid: 999_999_999, startedAt: "x" }));
    expect(() => acquireLock(dir)).not.toThrow();
    releaseLock(dir);
  });
});
