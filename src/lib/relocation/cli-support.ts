/**
 * Relocation wizard — testable CLI plumbing (same split as
 * src/lib/voximplant/cli-support.ts: the scripts/ entry stays thin wiring).
 *
 * Terminal copy is ENGLISH only (design §3 — terminal RTL is unreliable);
 * Hebrew renders on /admin from the state file's labels. Symbols never carry
 * meaning alone: every rendered line pairs the symbol with a word (Primer).
 */
import { parseArgs } from "node:util";

import type { RelocationState } from "./state";
import type { PreflightFinding } from "./preflight";

/** Execute-mode exit codes (design §3). Dry-run uses the Terraform-style trio. */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  DRY_RUN_CHANGES: 2,
  GATE_NEEDS_DECISION: 3,
  WAITING_EXTERNAL: 4,
  LOCK_HELD: 5,
} as const;

export interface CliOptions {
  command: "run" | "repair" | "help";
  target?: string;
  /** Install mode (plan §5b): bare/partial server → fully-running site. */
  install: boolean;
  dryRun: boolean;
  resume: boolean;
  rollback: boolean;
  nonInteractive: boolean;
  noColor: boolean;
  /** gate approvals: bare gate id, or gate=choice. */
  approvals: Map<string, string>;
  repairStepId?: string;
  repairStatus?: "done" | "pending";
}

export type ParsedCli = { ok: true; options: CliOptions } | { ok: false; error: string };

export function parseCliArgs(argv: string[]): ParsedCli {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        target: { type: "string" },
        install: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        resume: { type: "boolean", default: false },
        rollback: { type: "boolean", default: false },
        "non-interactive": { type: "boolean", default: false },
        approve: { type: "string" },
        "no-color": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        step: { type: "string" },
        status: { type: "string" },
      },
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const { values, positionals } = parsed;
  if (values.help) {
    return { ok: true, options: baseOptions("help", values) };
  }

  if (positionals[0] === "repair") {
    const stepId = typeof values.step === "string" ? values.step : undefined;
    const status = typeof values.status === "string" ? values.status : undefined;
    if (!stepId) return { ok: false, error: "repair requires --step <id>" };
    if (status !== "done" && status !== "pending") {
      return { ok: false, error: "repair requires --status done|pending" };
    }
    const options = baseOptions("repair", values);
    options.repairStepId = stepId;
    options.repairStatus = status;
    return { ok: true, options };
  }
  if (positionals.length > 0) {
    return { ok: false, error: `unknown command: ${positionals.join(" ")}` };
  }

  return { ok: true, options: baseOptions("run", values) };
}

function baseOptions(
  command: CliOptions["command"],
  values: {
    target?: string;
    install?: boolean;
    "dry-run"?: boolean;
    resume?: boolean;
    rollback?: boolean;
    "non-interactive"?: boolean;
    approve?: string;
    "no-color"?: boolean;
  },
): CliOptions {
  const approvals = new Map<string, string>();
  for (const entry of (values.approve ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf("=");
    if (eq === -1) approvals.set(entry, "approved");
    else approvals.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  return {
    command,
    target: values.target,
    install: Boolean(values.install),
    dryRun: Boolean(values["dry-run"]),
    resume: Boolean(values.resume),
    rollback: Boolean(values.rollback),
    nonInteractive: Boolean(values["non-interactive"]),
    noColor: Boolean(values["no-color"]) || Boolean(process.env.NO_COLOR),
    approvals,
  };
}

export const USAGE = `KALFA Relocation Wizard (preflight + dry-run build)

Usage:
  npm run relocate -- --target https://new-domain.com --dry-run [--non-interactive]
  npm run relocate -- --install --target https://domain.com --dry-run
  npm run relocate -- --resume | --rollback
  npm run relocate -- repair --step <id> --status done|pending

Flags:
  --target <origin>     bare https origin to relocate to
  --install             install mode: bare/partial server -> fully-running site (plan 5b)
  --dry-run             preflight + full change plan; mutates nothing (exit 0/1/2)
  --resume              continue a previous run from its state file
  --rollback            walk completed steps backwards
  --non-interactive     no prompts; gates via --approve (unapproved gate = exit 3)
  --approve a,b=choice  approve gates by id (choice gates: gate=value)
  --no-color            plain output (NO_COLOR env also honored)

This build executes NOTHING beyond the read-only preflight: mutating stages are
plan-only and refuse to apply. There is deliberately no bare --yes.`;

const FINDING_RENDER: Record<PreflightFinding["status"], { symbol: string; word: string }> = {
  ok: { symbol: "✓", word: "ok      " },
  blocked: { symbol: "✗", word: "blocked " },
  decision: { symbol: "!", word: "decision" },
  open: { symbol: "!", word: "open    " },
  na: { symbol: "-", word: "n/a     " },
  unknown: { symbol: "?", word: "unknown " },
};

export function renderFindingLine(finding: PreflightFinding): string {
  const { symbol, word } = FINDING_RENDER[finding.status];
  return `${symbol} ${word} ${finding.label.en}: ${finding.detail}`;
}

export function findingsSummary(findings: readonly PreflightFinding[]): string {
  const count = (s: PreflightFinding["status"]) => findings.filter((f) => f.status === s).length;
  return `${count("blocked")} blocker(s), ${count("decision")} decision(s), ${count("open")} open item(s), ${count("unknown")} unknown`;
}

/** Grouped dry-run plan rendering from the persisted state (planLines). */
export function renderPlan(state: RelocationState): string[] {
  const lines: string[] = [];
  for (const stage of state.stages) {
    const withPlans = stage.steps.filter((s) => (s.planLines?.length ?? 0) > 0);
    if (withPlans.length === 0) continue;
    lines.push(`${stage.id}  ${stage.label.en}`);
    for (const step of withPlans) {
      lines.push(`   ${step.id}  ${step.label.en}`);
      for (const planLine of step.planLines ?? []) lines.push(`       - ${planLine}`);
    }
  }
  return lines;
}

/** Non-TTY machine line: no color, explicit state, no truncation (Primer). */
export function eventLogLine(timestamp: string, id: string, status: string, detail: string): string {
  return [timestamp, id, status, detail].join("\t");
}

/**
 * The ONLY place that sets RELOCATE_EXECUTE — every mutator across the
 * execution layer (exec/nginx/env-rewrite/pm2/external/setup-form) refuses to
 * run unless this is "1". Guaranteed unset before the call, "1" strictly for
 * its duration, and unset again afterward — including on a thrown error —
 * via `finally`. `run` is injected so tests can assert the env-var lifecycle
 * around a mocked engine.runSteps() without touching a real system.
 */
export async function runWithExecuteLatch<T>(run: () => Promise<T>): Promise<T> {
  process.env.RELOCATE_EXECUTE = "1";
  try {
    return await run();
  } finally {
    delete process.env.RELOCATE_EXECUTE;
  }
}
