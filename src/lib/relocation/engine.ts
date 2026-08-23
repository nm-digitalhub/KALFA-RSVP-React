/**
 * Relocation wizard — step engine.
 *
 * The ledger/renderer split (design doc §1): this engine owns WHAT HAPPENED —
 * it persists every transition to the state file via state-io — and knows
 * nothing about presentation. The CLI renders; /admin renders; neither decides.
 *
 * Loop per step: check → (dry-run: collect plan and continue) → gate →
 * backup → persist running → apply → verify → persist done. A failed verify
 * HALTS the run — there is deliberately no "continue anyway" (plan §5 S6).
 * Rollback walks done/failed steps in reverse. `repair` is the explicit human
 * override when the ledger and reality disagree (Supabase `migration repair`
 * convention) — never hand-edit the state file.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";

import { GATE_LABELS, STAGE_LABELS } from "./labels";
import {
  GATE_IDS,
  HEARTBEAT_INTERVAL_SECONDS,
  RELOCATE_LOCK_FILE,
  type GateId,
  type Label,
  type OpenItem,
  type RelocationState,
  type RunMode,
  type StageId,
  type StepState,
} from "./state";
import { ensureRelocateDir, saveState } from "./state-io";

export class NotImplementedError extends Error {}
export class LockHeldError extends Error {
  constructor(public readonly holderPid: number) {
    super(`another relocation run holds the lock (pid ${holderPid})`);
  }
}

export interface WizardContext {
  repoRoot: string;
  targetOrigin: string;
  previousOrigin: string;
  mode: RunMode;
}

export interface VerifyCheck {
  label: Label;
  ok: boolean;
  detail?: string;
}

/**
 * The engine unit ("Step" is the persisted STATE record in ./state.ts; this is
 * the executable definition — verifier fix #5).
 */
export interface StepDefinition<Ctx = WizardContext> {
  id: string;
  stage: StageId;
  label: Label;
  /** Owner-approval gate that must be `approved` before apply. */
  gate?: GateId;
  /** Idempotency probe: 'done' ⇒ reality already matches, skip apply. */
  check(ctx: Ctx): Promise<"pending" | "done" | "blocked">;
  /** Human-readable change lines for the dry-run plan. */
  plan(ctx: Ctx): Promise<string[]>;
  backup?(ctx: Ctx): Promise<{ path: string; backupPath: string }[]>;
  apply(ctx: Ctx): Promise<void>;
  verify(ctx: Ctx): Promise<{ ok: boolean; checks: VerifyCheck[] }>;
  rollback?(ctx: Ctx, saved: { path: string; backupPath: string }[]): Promise<void>;
}

export type EngineEvent =
  | { type: "step-start"; step: StepState }
  | { type: "step-done"; step: StepState }
  | { type: "step-skipped"; step: StepState }
  | { type: "step-failed"; step: StepState }
  | { type: "step-planned"; step: StepState }
  | { type: "step-rolled-back"; step: StepState };

export type RunOutcome =
  | { outcome: "completed" }
  | { outcome: "dry-run" }
  | { outcome: "failed"; stepId: string }
  | { outcome: "blocked"; stepId: string }
  | { outcome: "gate"; stepId: string; gateId: GateId };

/** The wizard must not run as root (design §2 writer identity): the state file
 * must stay readable by the app user, and elevation happens only through
 * `sudo -n` inside whitelisted steps. */
export function assertNotRoot(): void {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error(
      "relocate must run as the app/vhost user, not root — elevated commands run via sudo -n inside steps.",
    );
  }
}

/** Build a fresh state ledger from the step definitions. */
export function initState(opts: {
  runId: string;
  targetOrigin: string;
  previousOrigin: string;
  mode: RunMode;
  defs: readonly StepDefinition[];
}): RelocationState {
  const now = new Date().toISOString();
  const stageIds = [...new Set(opts.defs.map((d) => d.stage))];
  return {
    schemaVersion: 1,
    serial: 0,
    runId: opts.runId,
    createdAt: now,
    updatedAt: now,
    writer: { pid: process.pid, host: hostname(), user: userInfo().username },
    target: { origin: opts.targetOrigin },
    previous: { origin: opts.previousOrigin },
    mode: opts.mode,
    phase: "planning",
    stages: stageIds.map((id) => ({
      id,
      label: STAGE_LABELS[id],
      steps: opts.defs
        .filter((d) => d.stage === id)
        .map((d) => ({
          id: d.id,
          label: d.label,
          status: "pending" as const,
          attempt: 0,
          backups: [],
        })),
    })),
    gates: GATE_IDS.map((id) => ({
      id,
      label: GATE_LABELS[id].label,
      consequence: GATE_LABELS[id].consequence,
      status: "not-reached" as const,
    })),
    openItems: KNOWN_OPEN_ITEMS.map((item) => ({ ...item })),
    rollbacks: [],
    reportPath: null,
  };
}

/** Open items known BEFORE any run starts (plan doc Stage I, incl. the
 * 2026-08-23 full-DB re-sweep findings): origin-bound artifacts no wizard step
 * can migrate. Seeded at init so the dry-run plan and /admin show them from
 * day one; a real run resolves or re-confirms them in Stage I. */
export const KNOWN_OPEN_ITEMS: readonly OpenItem[] = [
  {
    id: "push-subscriptions",
    severity: "warn",
    label: {
      en: "Web-push subscriptions are origin-bound — existing ones die; users re-subscribe on next visit",
      he: "מנויי Push כבולים ל-origin — הקיימים יפוגו; משתמשים יירשמו מחדש בביקור הבא",
    },
  },
  {
    id: "passkeys-rp-id",
    severity: "warn",
    label: {
      en: "Passkeys are bound to RP ID (live-verified: the full current host) — they stop working on any new origin; users re-register",
      he: "מפתחות Passkey כבולים ל-RP ID (אומת מול ה-DB: הדומיין הנוכחי המלא) — יפסיקו לעבוד בכל כתובת חדשה; נדרש רישום מחדש",
    },
  },
  {
    id: "android-app-base-url",
    severity: "warn",
    label: {
      en: "Installed Android console app POSTs to the old origin (hardcoded base URL) — keep /api/* proxied until a new release ships",
      he: "אפליקציית האנדרואיד המותקנת שולחת לכתובת הישנה (base URL קשיח) — להשאיר פרוקסי ל-/api/* עד גרסה חדשה",
    },
  },
  {
    id: "meta-template-approval",
    severity: "info",
    label: {
      en: "Meta _v2 template approval is Meta-paced — old URL buttons ride the 301 until approved",
      he: "אישור תבניות _v2 בקצב של Meta — כפתורי URL ישנים עוברים דרך ה-301 עד לאישור",
    },
  },
];

export function findStep(state: RelocationState, stepId: string): StepState {
  for (const stage of state.stages) {
    const step = stage.steps.find((s) => s.id === stepId);
    if (step) return step;
  }
  throw new Error(`unknown step id: ${stepId}`);
}

interface LockPayload {
  pid: number;
  host: string;
  user: string;
  startedAt: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One wizard run at a time (certbot's lock model). Stale locks (dead pid) are
 * reclaimed silently. */
export function acquireLock(repoRoot: string): void {
  ensureRelocateDir(repoRoot);
  const lockFile = join(repoRoot, RELOCATE_LOCK_FILE);
  if (existsSync(lockFile)) {
    try {
      const holder = JSON.parse(readFileSync(lockFile, "utf8")) as LockPayload;
      if (typeof holder.pid === "number" && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
        throw new LockHeldError(holder.pid);
      }
    } catch (err) {
      if (err instanceof LockHeldError) throw err;
      // Unreadable lock = stale garbage; reclaim.
    }
  }
  const payload: LockPayload = {
    pid: process.pid,
    host: hostname(),
    user: userInfo().username,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(lockFile, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
}

export function releaseLock(repoRoot: string): void {
  const lockFile = join(repoRoot, RELOCATE_LOCK_FILE);
  try {
    const holder = JSON.parse(readFileSync(lockFile, "utf8")) as LockPayload;
    if (holder.pid === process.pid) rmSync(lockFile, { force: true });
  } catch {
    /* already gone or not ours */
  }
}

export interface RunOptions {
  defs: readonly StepDefinition[];
  ctx: WizardContext;
  state: RelocationState;
  repoRoot: string;
  dryRun: boolean;
  /** Persist hook — defaults to state-io saveState; injectable for tests. */
  persist?: (state: RelocationState) => void;
  onEvent?: (event: EngineEvent) => void;
  /** Heartbeat while executing (design §2). Off in tests. */
  heartbeat?: boolean;
}

export async function runSteps(opts: RunOptions): Promise<RunOutcome> {
  const persist = opts.persist ?? ((s: RelocationState) => saveState(opts.repoRoot, s));
  const emit = opts.onEvent ?? (() => undefined);
  const { state, ctx } = opts;

  state.phase = opts.dryRun ? "planning" : "executing";
  persist(state);

  let ticker: NodeJS.Timeout | null = null;
  if (!opts.dryRun && opts.heartbeat !== false) {
    ticker = setInterval(() => persist(state), HEARTBEAT_INTERVAL_SECONDS * 1000);
    ticker.unref?.();
  }

  try {
    for (const def of opts.defs) {
      const step = findStep(state, def.id);
      if (step.status === "done" || step.status === "skipped") continue; // resume

      if (opts.dryRun) {
        step.planLines = await def.plan(ctx);
        emit({ type: "step-planned", step });
        continue;
      }

      const probe = await def.check(ctx);
      if (probe === "done") {
        step.status = "done";
        step.endedAt = new Date().toISOString();
        persist(state);
        emit({ type: "step-skipped", step });
        continue;
      }
      if (probe === "blocked") {
        step.status = "needs-decision";
        state.phase = "blocked";
        persist(state);
        return { outcome: "blocked", stepId: def.id };
      }

      if (def.gate) {
        const gate = state.gates.find((g) => g.id === def.gate);
        if (!gate || gate.status !== "approved") {
          if (gate && gate.status === "not-reached") gate.status = "open";
          state.phase = "blocked";
          persist(state);
          return { outcome: "gate", stepId: def.id, gateId: def.gate };
        }
      }

      step.attempt += 1;
      step.startedAt = new Date().toISOString();
      step.status = "running";
      if (def.backup) step.backups = await def.backup(ctx);
      persist(state);
      emit({ type: "step-start", step });

      try {
        await def.apply(ctx);
        const verification = await def.verify(ctx);
        step.verification = {
          ok: verification.ok,
          checks: verification.checks,
        };
        if (!verification.ok) throw new Error("verification failed");
        step.status = "done";
        step.endedAt = new Date().toISOString();
        persist(state);
        emit({ type: "step-done", step });
      } catch (err) {
        step.status = "failed";
        step.endedAt = new Date().toISOString();
        step.error = {
          message: sanitizeErrorMessage(err),
          logPath: join(opts.repoRoot, ".relocate", `${state.runId}-${def.id}.log`),
        };
        state.phase = "failed";
        persist(state);
        emit({ type: "step-failed", step });
        return { outcome: "failed", stepId: def.id };
      }
    }

    if (opts.dryRun) {
      persist(state);
      return { outcome: "dry-run" };
    }
    state.phase = "done";
    persist(state);
    return { outcome: "completed" };
  } finally {
    if (ticker) clearInterval(ticker);
  }
}

/** Walk done/failed steps in REVERSE definition order, calling rollback with
 * the recorded backups. */
export async function rollbackRun(opts: {
  defs: readonly StepDefinition[];
  ctx: WizardContext;
  state: RelocationState;
  repoRoot: string;
  persist?: (state: RelocationState) => void;
  onEvent?: (event: EngineEvent) => void;
}): Promise<void> {
  const persist = opts.persist ?? ((s: RelocationState) => saveState(opts.repoRoot, s));
  const emit = opts.onEvent ?? (() => undefined);
  const { state, ctx } = opts;
  state.phase = "rolling-back";
  persist(state);

  for (const def of [...opts.defs].reverse()) {
    const step = findStep(state, def.id);
    if (step.status !== "done" && step.status !== "failed") continue;
    if (def.rollback) await def.rollback(ctx, step.backups);
    step.status = "rolled-back";
    state.rollbacks.push({ stepId: def.id, at: new Date().toISOString() });
    persist(state);
    emit({ type: "step-rolled-back", step });
  }

  state.phase = "aborted";
  persist(state);
}

/** Explicit human override (Supabase `migration repair` convention). */
export function repairStep(
  state: RelocationState,
  stepId: string,
  status: "done" | "pending",
): StepState {
  const step = findStep(state, stepId);
  step.status = status;
  if (status === "pending") {
    delete step.error;
    delete step.verification;
    delete step.endedAt;
  } else {
    step.endedAt = new Date().toISOString();
  }
  return step;
}

/** One line, and never a stack, an env value, or a token. Paths are allowed in
 * the log file, not in the state message. */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.split("\n")[0].slice(0, 200);
  return oneLine.replace(/\/[^\s]+/g, "<path>");
}
