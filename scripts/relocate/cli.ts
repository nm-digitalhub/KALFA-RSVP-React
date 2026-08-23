/**
 * KALFA Relocation Wizard — CLI entry (thin wiring; logic lives in
 * src/lib/relocation/*, same split as scripts/voximplant/cli.ts).
 *
 * Run via `npm run relocate -- …` (tsx). THIS BUILD: read-only preflight +
 * dry-run plan only — every mutating stage refuses to apply
 * (NotImplementedError), so no invocation of this file can change nginx, pm2,
 * env files, DNS, certificates, external services, or the database.
 *
 * Design: docs/relocation-wizard-design-2026-08-23.md (§3 CLI, §2 contract).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";

import { cancel, intro, isCancel, log, outro, spinner, text } from "@clack/prompts";

import {
  EXIT,
  USAGE,
  eventLogLine,
  findingsSummary,
  parseCliArgs,
  renderFindingLine,
  renderPlan,
  type CliOptions,
} from "@/lib/relocation/cli-support";
import {
  LockHeldError,
  acquireLock,
  assertNotRoot,
  initState,
  releaseLock,
  repairStep,
  rollbackRun,
  runSteps,
  type WizardContext,
} from "@/lib/relocation/engine";
import {
  parseEnvFile,
  runPreflight,
  validateTargetOrigin,
  type PreflightFinding,
} from "@/lib/relocation/preflight";
import { buildStepDefinitions } from "@/lib/relocation/steps";
import { loadState, saveState } from "@/lib/relocation/state-io";
import { GATE_IDS, type RelocationState } from "@/lib/relocation/state";

function fail(message: string, code: number = EXIT.ERROR): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readEnvLocal(repoRoot: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(join(repoRoot, ".env.local"), "utf8"));
  } catch {
    fail(".env.local not found or unreadable — run from the repo root.");
  }
}

function currentOriginFrom(env: Record<string, string>): string {
  const raw = env.APP_ORIGIN?.trim();
  if (!raw) fail("APP_ORIGIN is missing from .env.local — cannot determine the current origin.");
  try {
    return new URL(raw).origin;
  } catch {
    fail("APP_ORIGIN in .env.local is not a valid URL.");
  }
}

function applyApprovals(state: RelocationState, approvals: CliOptions["approvals"]): void {
  for (const [gateId, choice] of approvals) {
    if (!(GATE_IDS as readonly string[]).includes(gateId)) {
      fail(`--approve references an unknown gate: ${gateId}`);
    }
    const gate = state.gates.find((g) => g.id === gateId);
    if (!gate) continue;
    gate.status = "approved";
    gate.decidedAt = new Date().toISOString();
    gate.decidedBy = "flag";
    gate.choice = choice;
  }
}

async function promptForTarget(currentOrigin: string): Promise<string> {
  const answer = await text({
    message: "Target origin (https://…):",
    placeholder: "https://example.com",
    validate: (value) => {
      const check = validateTargetOrigin(value ?? "", currentOrigin);
      return check.ok ? undefined : check.reason;
    },
  });
  if (isCancel(answer)) {
    cancel("Cancelled — nothing was changed. Run again anytime.");
    process.exit(EXIT.OK);
  }
  return answer;
}

function printFindings(findings: PreflightFinding[], interactive: boolean, color: boolean): void {
  for (const finding of findings) {
    const line = renderFindingLine(finding);
    const styled =
      color && finding.status === "blocked"
        ? styleText("red", line)
        : color && (finding.status === "decision" || finding.status === "open")
          ? styleText("yellow", line)
          : line;
    if (interactive) log.message(styled);
    else process.stdout.write(`${eventLogLine(new Date().toISOString(), finding.id, finding.status, `${finding.label.en}: ${finding.detail}`)}\n`);
  }
  const summary = findingsSummary(findings);
  if (interactive) log.info(summary);
  else process.stdout.write(`${summary}\n`);
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) fail(`${parsed.error}\n\n${USAGE}`);
  const options = parsed.options;

  if (options.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    process.exit(EXIT.OK);
  }

  assertNotRoot();
  const repoRoot = process.cwd();

  if (options.command === "repair") {
    const loaded = loadState(repoRoot);
    if (!loaded.ok) fail(`no repairable state (${loaded.reason}).`);
    try {
      const step = repairStep(loaded.state, options.repairStepId!, options.repairStatus!);
      saveState(repoRoot, loaded.state);
      process.stdout.write(`repair: ${step.id} → ${step.status}\n`);
    } catch (err) {
      fail((err as Error).message);
    }
    process.exit(EXIT.OK);
  }

  const env = readEnvLocal(repoRoot);
  const currentOrigin = currentOriginFrom(env);
  const defs = buildStepDefinitions();
  const interactive = Boolean(process.stdout.isTTY) && !options.nonInteractive;
  const color = !options.noColor && Boolean(process.stdout.isTTY);

  if (options.rollback) {
    const loaded = loadState(repoRoot);
    if (!loaded.ok) fail(`nothing to roll back (${loaded.reason}).`);
    try {
      acquireLock(repoRoot);
    } catch (err) {
      if (err instanceof LockHeldError) fail(err.message, EXIT.LOCK_HELD);
      throw err;
    }
    try {
      const ctx: WizardContext = {
        repoRoot,
        targetOrigin: loaded.state.target.origin,
        previousOrigin: loaded.state.previous.origin,
        mode: loaded.state.mode,
      };
      await rollbackRun({ defs, ctx, state: loaded.state, repoRoot });
      process.stdout.write(`rolled back ${loaded.state.rollbacks.length} step(s).\n`);
    } finally {
      releaseLock(repoRoot);
    }
    process.exit(EXIT.OK);
  }

  let state: RelocationState;
  let targetOrigin: string;

  if (options.resume) {
    const loaded = loadState(repoRoot);
    if (!loaded.ok) fail(`nothing to resume (${loaded.reason}).`);
    state = loaded.state;
    targetOrigin = state.target.origin;
  } else {
    let rawTarget = options.target;
    if (!rawTarget) {
      if (!interactive) fail(`--target is required in non-interactive mode.\n\n${USAGE}`);
      rawTarget = await promptForTarget(currentOrigin);
    }
    const validated = validateTargetOrigin(rawTarget, currentOrigin);
    if (!validated.ok) fail(`invalid --target: ${validated.reason}`);
    targetOrigin = validated.origin;
    state = initState({
      runId: randomBytes(3).toString("hex"),
      targetOrigin,
      previousOrigin: currentOrigin,
      mode: options.dryRun ? "dry-run" : options.nonInteractive ? "non-interactive" : "interactive",
      defs,
    });
  }

  if (interactive) intro(`KALFA Relocation Wizard — ${currentOrigin} → ${targetOrigin}`);

  const ctx: WizardContext = {
    repoRoot,
    targetOrigin,
    previousOrigin: currentOrigin,
    mode: state.mode,
  };

  const preflightSpinner = interactive ? spinner() : null;
  preflightSpinner?.start("Running read-only preflight checks");
  const findings = await runPreflight({ repoRoot, env, currentOrigin, targetOrigin });
  preflightSpinner?.stop(`Preflight — ${findings.length} checks`);
  printFindings(findings, interactive, color);

  applyApprovals(state, options.approvals);

  try {
    acquireLock(repoRoot);
  } catch (err) {
    if (err instanceof LockHeldError) fail(err.message, EXIT.LOCK_HELD);
    throw err;
  }

  try {
    if (options.dryRun) {
      await runSteps({ defs, ctx, state, repoRoot, dryRun: true });
      const planLines = renderPlan(state);
      const header = `Plan: ${currentOrigin} → ${targetOrigin}   (${defs.length} steps; nothing executed)`;
      if (interactive) {
        log.message([header, ...planLines].join("\n"));
        outro("Dry run complete — state saved to .relocation-state.json; nothing was changed.");
      } else {
        process.stdout.write(`${header}\n`);
        for (const line of planLines) process.stdout.write(`${line}\n`);
        process.stdout.write("dry-run complete; nothing was changed.\n");
      }
      process.exit(EXIT.DRY_RUN_CHANGES);
    }

    const message =
      "This build supports the read-only preflight and --dry-run only — mutating stages are plan-only and refuse to run.";
    if (interactive) outro(message);
    else process.stdout.write(`${message}\n`);
    process.exit(EXIT.ERROR);
  } finally {
    releaseLock(repoRoot);
  }
}

main().catch((err) => {
  process.stderr.write(`relocate: ${(err as Error).message}\n`);
  process.exit(EXIT.ERROR);
});
