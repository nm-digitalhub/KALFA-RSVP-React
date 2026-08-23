/**
 * Relocation wizard — the shared state contract.
 *
 * `.relocation-state.json` is the single interface between the CLI wizard
 * (scripts/relocate/, the only writer) and the /admin/relocation page (a
 * read-only renderer). Both sides parse THROUGH this schema; neither invents
 * fields the other cannot see. Full contract: docs/relocation-wizard-design-2026-08-23.md §2.
 *
 * Invariants the writer guarantees (the reader may rely on):
 * - atomic replace (temp file + rename) on every transition; never a partial write
 * - `updatedAt` is a heartbeat, touched at least every 30s while phase === 'executing'
 * - `error.message` is a pre-sanitized one-liner — no secrets, no absolute paths
 * - no secret ever enters this file; paths appear only in fields the /admin
 *   view schema strips (backups, externalCalls, error.logPath, reportPath)
 */
import { z } from "zod";

export const RELOCATION_STATE_FILE = ".relocation-state.json";
export const RELOCATION_STATE_BACKUP_FILE = ".relocation-state.json.bak";
export const RELOCATE_DIR = ".relocate";
export const RELOCATE_LOCK_FILE = ".relocate/lock";

/** Heartbeat cadence the writer promises; readers treat > 2× staleness while
 * executing as "wizard process not responding" (design §2 derivation rules). */
export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const HEARTBEAT_STALE_AFTER_SECONDS = 120;

export const zLabel = z.object({ en: z.string(), he: z.string() });
export type Label = z.infer<typeof zLabel>;

export const STEP_STATUSES = [
  "pending",
  "running",
  "waiting-external",
  "needs-decision",
  "done",
  "skipped",
  "failed",
  "rolled-back",
] as const;
export const zStepStatus = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof zStepStatus>;

export const STAGE_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
export const zStageId = z.enum(STAGE_IDS);
export type StageId = z.infer<typeof zStageId>;

export const GATE_IDS = [
  "conflict-existing-site",
  "voximplant-scenario-redeploy",
  "meta-template-submit",
  "meta-approval-override",
  "dns-write-local-zone",
  "go-live",
] as const;
export const zGateId = z.enum(GATE_IDS);
export type GateId = z.infer<typeof zGateId>;

export const WAITING_KINDS = [
  "dns-propagation",
  "meta-template-approval",
  "cert-issuance-retry",
] as const;
export const zWaitingKind = z.enum(WAITING_KINDS);
export type WaitingKind = z.infer<typeof zWaitingKind>;

export const RUN_PHASES = [
  "planning",
  "executing",
  "waiting",
  "blocked",
  "rolling-back",
  "done",
  "failed",
  "aborted",
] as const;
export const zRunPhase = z.enum(RUN_PHASES);
export type RunPhase = z.infer<typeof zRunPhase>;

export const RUN_MODES = ["interactive", "non-interactive", "dry-run"] as const;
export const zRunMode = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof zRunMode>;

export const zStepVerification = z.object({
  ok: z.boolean(),
  checks: z.array(
    z.object({ label: zLabel, ok: z.boolean(), detail: z.string().optional() }),
  ),
});
export type StepVerification = z.infer<typeof zStepVerification>;

export const zStepWaiting = z.object({
  kind: zWaitingKind,
  detail: zLabel,
  attempts: z.number().int().nonnegative(),
  nextPollAt: z.string(),
  pollEverySec: z.number().int().positive(),
});
export type StepWaiting = z.infer<typeof zStepWaiting>;

export const zStepState = z.object({
  id: z.string().min(1),
  label: zLabel,
  status: zStepStatus,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  attempt: z.number().int().nonnegative(), // 0 = never attempted; increments on each apply
  backups: z.array(z.object({ path: z.string(), backupPath: z.string() })),
  // Inverse args for third-party mutations so rollback can replay them with the
  // previous origin. Non-secret values only — the writer's responsibility.
  externalCalls: z
    .array(z.object({ service: z.string(), op: z.string(), prevValue: z.unknown() }))
    .optional(),
  verification: zStepVerification.optional(),
  waiting: zStepWaiting.optional(),
  // message is GUARANTEED pre-sanitized by the CLI (one line, no secrets/paths);
  // logPath is an absolute path and is stripped by the /admin view schema.
  error: z
    .object({ message: z.string(), logPath: z.string(), hint: zLabel.optional() })
    .optional(),
  // Plan-as-artifact (design §1 decision 3): the dry-run change lines reviewed
  // by the operator are stored on the step, so a later apply can refuse on
  // drift. Human-readable English lines; may reference paths, so the /admin
  // view schema strips it like other path-bearing fields.
  planLines: z.array(z.string()).optional(),
});
export type StepState = z.infer<typeof zStepState>;

export const zStage = z.object({
  id: zStageId,
  label: zLabel,
  steps: z.array(zStepState),
});
export type Stage = z.infer<typeof zStage>;

export const zGate = z.object({
  id: zGateId,
  label: zLabel,
  consequence: zLabel,
  status: z.enum(["not-reached", "open", "approved", "declined"]),
  decidedAt: z.string().optional(),
  decidedBy: z.enum(["operator", "flag"]).optional(),
  choice: z.string().optional(),
});
export type Gate = z.infer<typeof zGate>;

export const zOpenItem = z.object({
  id: z.string().min(1),
  label: zLabel,
  severity: z.enum(["info", "warn"]),
  resolvedAt: z.string().optional(),
});
export type OpenItem = z.infer<typeof zOpenItem>;

export const zRelocationState = z.object({
  schemaVersion: z.literal(1),
  serial: z.number().int().nonnegative(),
  runId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  writer: z
    .object({ pid: z.number().int(), host: z.string(), user: z.string() })
    .nullable(),
  target: z.object({ origin: z.string().min(1) }),
  previous: z.object({ origin: z.string().min(1) }),
  mode: zRunMode,
  phase: zRunPhase,
  stages: z.array(zStage),
  gates: z.array(zGate),
  openItems: z.array(zOpenItem),
  rollbacks: z.array(z.object({ stepId: z.string(), at: z.string() })),
  reportPath: z.string().nullable(),
});
export type RelocationState = z.infer<typeof zRelocationState>;

/** Parse an unknown JSON value into a RelocationState, or explain why not.
 * Pure — no IO; both the CLI (on load/resume) and the /admin data layer use it. */
export function parseRelocationState(
  value: unknown,
):
  | { ok: true; state: RelocationState }
  | { ok: false; reason: "invalid-schema" | "unsupported-version" } {
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    (value as { schemaVersion: unknown }).schemaVersion !== 1
  ) {
    return { ok: false, reason: "unsupported-version" };
  }
  const parsed = zRelocationState.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid-schema" };
  return { ok: true, state: parsed.data };
}

/** The renderer-shared focus rule (design §2): the first step that needs
 * attention, in stage order. CLI footer and /admin must agree on this. */
export function currentFocusStep(state: RelocationState): StepState | null {
  const attention: readonly StepStatus[] = [
    "running",
    "waiting-external",
    "needs-decision",
    "failed",
  ];
  for (const stage of state.stages) {
    for (const step of stage.steps) {
      if (attention.includes(step.status)) return step;
    }
  }
  return null;
}

/** Progress rule shared by both renderers: done / total non-skipped. */
export function progress(state: RelocationState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const stage of state.stages) {
    for (const step of stage.steps) {
      if (step.status === "skipped") continue;
      total += 1;
      if (step.status === "done") done += 1;
    }
  }
  return { done, total };
}

/** Heartbeat staleness rule (design §2): while executing, a writer that has not
 * touched updatedAt within the stale window renders as "not responding". */
export function isHeartbeatStale(state: RelocationState, now: Date): boolean {
  if (state.phase !== "executing") return false;
  const updated = Date.parse(state.updatedAt);
  if (Number.isNaN(updated)) return true;
  return now.getTime() - updated > HEARTBEAT_STALE_AFTER_SECONDS * 1000;
}
