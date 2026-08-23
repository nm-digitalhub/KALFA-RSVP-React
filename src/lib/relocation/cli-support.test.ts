import { describe, expect, it } from "vitest";

import { initState } from "./engine";
import { buildStepDefinitions } from "./steps";
import {
  EXIT,
  eventLogLine,
  findingsSummary,
  parseCliArgs,
  renderFindingLine,
  renderPlan,
  runWithExecuteLatch,
} from "./cli-support";
import type { PreflightFinding } from "./preflight";

describe("parseCliArgs", () => {
  it("parses a dry-run invocation", () => {
    const parsed = parseCliArgs(["--target", "https://x.example", "--dry-run", "--non-interactive"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.options.command).toBe("run");
      expect(parsed.options.target).toBe("https://x.example");
      expect(parsed.options.dryRun).toBe(true);
      expect(parsed.options.nonInteractive).toBe(true);
    }
  });

  it("parses gate approvals including choice syntax", () => {
    const parsed = parseCliArgs(["--approve", "go-live,conflict-existing-site=shadow"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.options.approvals.get("go-live")).toBe("approved");
      expect(parsed.options.approvals.get("conflict-existing-site")).toBe("shadow");
    }
  });

  it("parses the repair subcommand and validates its flags", () => {
    const good = parseCliArgs(["repair", "--step", "C3", "--status", "done"]);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.options.command).toBe("repair");
      expect(good.options.repairStepId).toBe("C3");
      expect(good.options.repairStatus).toBe("done");
    }
    expect(parseCliArgs(["repair", "--step", "C3"]).ok).toBe(false);
    expect(parseCliArgs(["repair", "--step", "C3", "--status", "maybe"]).ok).toBe(false);
    expect(parseCliArgs(["unknown-cmd"]).ok).toBe(false);
  });

  it("rejects unknown flags with a parse error, and has no bare --yes", () => {
    expect(parseCliArgs(["--yes"]).ok).toBe(false);
  });
});

describe("rendering", () => {
  const finding: PreflightFinding = {
    id: "dns",
    status: "blocked",
    label: { en: "DNS", he: "DNS" },
    detail: "target does not resolve yet",
  };

  it("pairs a symbol with a word so meaning survives no-color", () => {
    const line = renderFindingLine(finding);
    expect(line).toContain("✗");
    expect(line).toContain("blocked");
    expect(line).toContain("DNS: target does not resolve yet");
  });

  it("summarizes finding counts", () => {
    expect(findingsSummary([finding])).toContain("1 blocker(s)");
  });

  it("renders the dry-run plan grouped by stage from planLines", () => {
    const defs = buildStepDefinitions();
    const state = initState({
      runId: "r",
      targetOrigin: "https://new.example",
      previousOrigin: "https://old.example",
      mode: "dry-run",
      defs,
    });
    state.stages[0].steps[0].planLines = ["first line"];
    const lines = renderPlan(state);
    expect(lines[0]).toContain("B");
    expect(lines.some((l) => l.includes("first line"))).toBe(true);
  });

  it("emits tab-delimited machine lines", () => {
    expect(eventLogLine("t", "dns", "blocked", "detail")).toBe("t\tdns\tblocked\tdetail");
  });
});

describe("runWithExecuteLatch", () => {
  it("is unset by default, becomes '1' strictly during the run, and unsets again on success", async () => {
    expect(process.env.RELOCATE_EXECUTE).toBeUndefined();
    let sawDuring: string | undefined;
    const result = await runWithExecuteLatch(async () => {
      sawDuring = process.env.RELOCATE_EXECUTE;
      return { outcome: "completed" as const };
    });
    expect(sawDuring).toBe("1");
    expect(result).toEqual({ outcome: "completed" });
    expect(process.env.RELOCATE_EXECUTE).toBeUndefined();
  });

  it("unsets again even when the run throws (finally, not just the happy path)", async () => {
    let sawDuring: string | undefined;
    await expect(
      runWithExecuteLatch(async () => {
        sawDuring = process.env.RELOCATE_EXECUTE;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(sawDuring).toBe("1");
    expect(process.env.RELOCATE_EXECUTE).toBeUndefined();
  });
});

describe("exit codes", () => {
  it("keeps the documented split: execute 0/1/3/4/5, dry-run 2 for changes-pending", () => {
    expect(EXIT.OK).toBe(0);
    expect(EXIT.ERROR).toBe(1);
    expect(EXIT.DRY_RUN_CHANGES).toBe(2);
    expect(EXIT.GATE_NEEDS_DECISION).toBe(3);
    expect(EXIT.WAITING_EXTERNAL).toBe(4);
    expect(EXIT.LOCK_HELD).toBe(5);
  });
});
