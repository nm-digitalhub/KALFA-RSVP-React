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

import { cancel, confirm, intro, isCancel, log, outro, spinner, text } from "@clack/prompts";

import {
  EXIT,
  USAGE,
  eventLogLine,
  findingsSummary,
  parseCliArgs,
  renderFindingLine,
  renderPlan,
  runWithExecuteLatch,
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
  type RunOutcome,
  type StepDefinition,
  type WizardContext,
} from "@/lib/relocation/engine";
import {
  parseEnvFile,
  runPreflight,
  validateTargetOrigin,
  type PreflightFinding,
} from "@/lib/relocation/preflight";
import { buildInstallStepDefinitions } from "@/lib/relocation/install-steps";
import { buildStepDefinitions } from "@/lib/relocation/steps";
import { GATE_LABELS } from "@/lib/relocation/labels";
import { loadState, saveState } from "@/lib/relocation/state-io";
import { GATE_IDS, type Gate, type GateId, type RelocationState } from "@/lib/relocation/state";

/** Gates whose consequence is severe/irreversible enough to need the operator
 * to type the target domain, beyond a plain yes/no (design §3 — GitHub
 * danger-zone convention). go-live is the only one any CURRENT step actually
 * carries; conflict-existing-site is included for when it is (design intent). */
const TYPED_CONFIRMATION_GATES = new Set<GateId>(["go-live", "conflict-existing-site"]);

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

/** Interactive gate approval (design §3 gate anatomy): identity → evidence
 * (the plan already showed it) → consequence → options, safe choice
 * (decline) preselected; the two severe gates additionally require typing
 * the target domain. Ctrl-C here saves state and exits resumable — never a
 * silent default-approve. */
async function promptGate(gate: Gate, targetOrigin: string, repoRoot: string): Promise<boolean> {
  const meta = GATE_LABELS[gate.id];
  log.warn(`DECISION GATE ${gate.id}`);
  log.message(meta.label.en);
  log.message(meta.consequence.en);
  const approved = await confirm({ message: "Approve this gate?", initialValue: false });
  if (isCancel(approved)) {
    cancel("Cancelled — nothing further was changed. Resume anytime with --resume.");
    releaseLock(repoRoot);
    process.exit(EXIT.OK);
  }
  if (!approved) return false;
  if (TYPED_CONFIRMATION_GATES.has(gate.id)) {
    const host = new URL(targetOrigin).hostname;
    const typed = await text({ message: `Type the target domain to confirm (${host}):` });
    if (isCancel(typed)) {
      cancel("Cancelled — nothing further was changed. Resume anytime with --resume.");
      releaseLock(repoRoot);
      process.exit(EXIT.OK);
    }
    if (typed.trim() !== host) {
      log.error(`domain did not match — gate NOT approved`);
      return false;
    }
  }
  return true;
}

function nonInteractiveGateLine(gate: Gate): void {
  process.stdout.write(
    `${eventLogLine(new Date().toISOString(), gate.id, "needs-decision", `${GATE_LABELS[gate.id].label.en} — approve via --approve ${gate.id}[=choice] or run interactively`)}\n`,
  );
}

/**
 * The real (non-dry-run) execute path. Loops runSteps() — the engine stops
 * and returns {outcome:'gate', gateId} the instant it needs an unapproved
 * gate, never mutating past that point — approve exactly that one gate, then
 * call runSteps() again, which resumes (already-done steps are skipped, per
 * engine.ts's own resume discipline). RELOCATE_EXECUTE is set ONLY for the
 * duration of each runSteps() call via runWithExecuteLatch.
 */
async function executeRun(opts: {
  defs: StepDefinition[];
  ctx: WizardContext;
  state: RelocationState;
  repoRoot: string;
  interactive: boolean;
  nonInteractive: boolean;
}): Promise<never> {
  const exitReleasing = (code: number): never => {
    releaseLock(opts.repoRoot);
    process.exit(code);
  };
  for (;;) {
    const outcome: RunOutcome = await runWithExecuteLatch(() =>
      runSteps({ defs: opts.defs, ctx: opts.ctx, state: opts.state, repoRoot: opts.repoRoot, dryRun: false }),
    );

    if (outcome.outcome === "completed") {
      const report = `Relocation complete — ${opts.ctx.targetOrigin} is live. State: .relocation-state.json`;
      if (opts.interactive) outro(report);
      else process.stdout.write(`${report}\n`);
      return exitReleasing(EXIT.OK);
    }

    if (outcome.outcome === "failed") {
      const step = opts.state.stages.flatMap((s) => s.steps).find((s) => s.id === outcome.stepId);
      const msg = `FAILED at step ${outcome.stepId}: ${step?.error?.message ?? "unknown error"}\nNext: fix the underlying issue then --resume, or run --rollback.`;
      if (opts.interactive) outro(msg);
      else process.stdout.write(`${msg}\n`);
      return exitReleasing(EXIT.ERROR);
    }

    if (outcome.outcome === "blocked") {
      const msg = `BLOCKED at step ${outcome.stepId} — its check() reports the precondition cannot be satisfied. Fix and --resume.`;
      if (opts.interactive) outro(msg);
      else process.stdout.write(`${msg}\n`);
      return exitReleasing(EXIT.ERROR);
    }

    if (outcome.outcome === "dry-run") {
      // Unreachable: executeRun always calls runSteps with dryRun:false.
      // `return` (not a bare call) is required here even though fail()
      // is typed `never`: this if-block sits inside a `for (;;)` loop, and
      // TS's control-flow narrowing of the `outcome` discriminated union
      // does not reliably eliminate this arm across the loop's back-edge
      // from a bare statement-position call alone — an explicit `return`
      // makes the block's non-completion unambiguous to the checker,
      // matching the pattern every other arm in this function already uses
      // (`return exitReleasing(...)`).
      releaseLock(opts.repoRoot);
      return fail("internal error: executeRun received a dry-run outcome");
    }

    // outcome.outcome === "gate" (the only remaining case)
    const gate = opts.state.gates.find((g) => g.id === outcome.gateId);
    if (!gate) {
      releaseLock(opts.repoRoot);
      return fail(`internal error: unknown gate ${outcome.gateId}`);
    }
    if (!opts.interactive || opts.nonInteractive) {
      nonInteractiveGateLine(gate);
      releaseLock(opts.repoRoot);
      return fail(`gate needs a decision: ${gate.id}`, EXIT.GATE_NEEDS_DECISION);
    }
    const approved = await promptGate(gate, opts.ctx.targetOrigin, opts.repoRoot);
    gate.status = approved ? "approved" : "declined";
    gate.decidedAt = new Date().toISOString();
    gate.decidedBy = "operator";
    saveState(opts.repoRoot, opts.state);
    if (!approved) {
      const msg = `Gate ${gate.id} declined — nothing further was changed. Re-run --resume after reconsidering.`;
      outro(msg);
      return exitReleasing(EXIT.OK);
    }
    // loop: runSteps() resumes past already-done steps and re-evaluates this gate as approved
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

  // Install mode targets a possibly-fresh server: .env.local may not exist
  // yet (its provisioning is step I4). Relocation mode still hard-requires it.
  let env: Record<string, string>;
  let currentOrigin: string;
  if (options.install) {
    try {
      env = parseEnvFile(readFileSync(join(repoRoot, ".env.local"), "utf8"));
    } catch {
      env = {};
    }
    currentOrigin = env.APP_ORIGIN?.trim() || options.target || "";
  } else {
    env = readEnvLocal(repoRoot);
    currentOrigin = currentOriginFrom(env);
  }
  const defsFor = (install: boolean) =>
    install ? buildInstallStepDefinitions() : buildStepDefinitions();
  let defs = defsFor(options.install);
  const interactive = Boolean(process.stdout.isTTY) && !options.nonInteractive;
  const color = !options.noColor && Boolean(process.stdout.isTTY);

  if (options.rollback) {
    const loaded = loadState(repoRoot);
    if (!loaded.ok) fail(`nothing to roll back (${loaded.reason}).`);
    defs = defsFor(loaded.state.flavor === "install");
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
    defs = defsFor(state.flavor === "install");
  } else {
    let rawTarget = options.target;
    if (!rawTarget) {
      if (!interactive) fail(`--target is required in non-interactive mode.\n\n${USAGE}`);
      rawTarget = await promptForTarget(currentOrigin);
    }
    // Install mode may legitimately target the CURRENT origin (fresh server,
    // or re-install on the same domain) — only relocation forbids target ==
    // current.
    const validated = validateTargetOrigin(rawTarget, options.install ? "" : currentOrigin);
    if (!validated.ok) fail(`invalid --target: ${validated.reason}`);
    targetOrigin = validated.origin;
    state = initState({
      runId: randomBytes(3).toString("hex"),
      targetOrigin,
      previousOrigin: currentOrigin,
      mode: options.dryRun ? "dry-run" : options.nonInteractive ? "non-interactive" : "interactive",
      flavor: options.install ? "install" : "relocate",
      defs,
    });
  }

  if (interactive) {
    intro(
      options.install
        ? `KALFA Install Wizard — bring the site fully up at ${targetOrigin}`
        : `KALFA Relocation Wizard — ${currentOrigin} → ${targetOrigin}`,
    );
  }

  const ctx: WizardContext = {
    repoRoot,
    targetOrigin,
    previousOrigin: currentOrigin,
    mode: state.mode,
  };

  const preflightSpinner = interactive ? spinner() : null;
  // Shorter than any stop() message — a longer start leaves residue text in
  // terminals whose clear-line handling is partial (seen live: "13 checksflight checks").
  preflightSpinner?.start("Preflight…");
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

    // Real execute mode. executeRun() always terminates via process.exit()
    // (never returns/throws normally) and releases the lock itself right
    // before each exit — a `finally` here would not reliably run after
    // process.exit(), same as the dry-run branch above.
    await executeRun({ defs, ctx, state, repoRoot, interactive, nonInteractive: options.nonInteractive });
  } finally {
    releaseLock(repoRoot);
  }
}

main().catch((err) => {
  process.stderr.write(`relocate: ${(err as Error).message}\n`);
  process.exit(EXIT.ERROR);
});
