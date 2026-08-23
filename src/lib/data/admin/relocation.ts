import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  RELOCATION_STATE_FILE,
  isHeartbeatStale,
  parseRelocationState,
  progress,
  currentFocusStep,
  type GateId,
  type Label,
  type RelocationState,
  type RunMode,
  type RunPhase,
  type StageId,
  type StepStatus,
  type WaitingKind,
} from '@/lib/relocation/state';

// Read-only data layer for /admin/relocation: renders the CLI wizard's
// `.relocation-state.json` (docs/relocation-wizard-design-2026-08-23.md §2/§4).
// This module is the WHITELIST boundary: the state file legitimately contains
// absolute server paths (backups, error.logPath, reportPath, planLines) and
// writer process identity — none of that may reach the browser. The view type
// below is built field-by-field (never spread) so a new state-file field is
// invisible to the page until deliberately added here.
//
// Soft-failing by design: the writer replaces the file atomically, but a read
// can still race a run's very first write, hit a permissions problem, or find
// a state written by a future schema — each maps to a distinct kind the page
// renders as its own gentle state. Never throws for file problems; the ONLY
// throw path is the auth gate.

export type RelocationStepView = {
  id: string;
  label: Label;
  status: StepStatus;
  startedAt: string | null;
  endedAt: string | null;
  attempt: number;
  verification: {
    ok: boolean;
    checks: { label: Label; ok: boolean; detail: string | null }[];
  } | null;
  waiting: {
    kind: WaitingKind;
    detail: Label;
    attempts: number;
    nextPollAt: string;
    pollEverySec: number;
  } | null;
  // message is the CLI's pre-sanitized one-liner; logPath is deliberately absent.
  error: { message: string; hint: Label | null } | null;
};

export type RelocationStageView = {
  id: StageId;
  label: Label;
  steps: RelocationStepView[];
};

export type RelocationGateView = {
  id: GateId;
  label: Label;
  consequence: Label;
  status: 'not-reached' | 'open' | 'approved' | 'declined';
  decidedAt: string | null;
  choice: string | null;
};

export type RelocationRunView = {
  runId: string;
  mode: RunMode;
  /** relocation run (default) or full install run (plan §5b). */
  flavor: 'relocate' | 'install';
  phase: RunPhase;
  targetOrigin: string;
  previousOrigin: string;
  createdAt: string;
  updatedAt: string;
  writerPresent: boolean;
  // Heartbeat rule (state.ts): executing + updatedAt older than the stale
  // window ⇒ the wizard process is not responding. Computed server-side so the
  // page never needs a client clock.
  writerStale: boolean;
  progress: { done: number; total: number };
  focusStepId: string | null;
  stages: RelocationStageView[];
  gates: RelocationGateView[];
  openItems: { id: string; label: Label; severity: 'info' | 'warn'; resolvedAt: string | null }[];
  rollbacks: { stepId: string; at: string }[];
};

export type RelocationView =
  | { kind: 'no-run' }
  | { kind: 'unreadable' }
  | { kind: 'unsupported-version' }
  | { kind: 'ok'; run: RelocationRunView };

function toView(state: RelocationState, now: Date): RelocationRunView {
  return {
    runId: state.runId,
    mode: state.mode,
    flavor: state.flavor ?? 'relocate',
    phase: state.phase,
    targetOrigin: state.target.origin,
    previousOrigin: state.previous.origin,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    writerPresent: state.writer !== null,
    writerStale: isHeartbeatStale(state, now),
    progress: progress(state),
    focusStepId: currentFocusStep(state)?.id ?? null,
    stages: state.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      steps: stage.steps.map((step) => ({
        id: step.id,
        label: step.label,
        status: step.status,
        startedAt: step.startedAt ?? null,
        endedAt: step.endedAt ?? null,
        attempt: step.attempt,
        verification: step.verification
          ? {
              ok: step.verification.ok,
              checks: step.verification.checks.map((check) => ({
                label: check.label,
                ok: check.ok,
                detail: check.detail ?? null,
              })),
            }
          : null,
        waiting: step.waiting
          ? {
              kind: step.waiting.kind,
              detail: step.waiting.detail,
              attempts: step.waiting.attempts,
              nextPollAt: step.waiting.nextPollAt,
              pollEverySec: step.waiting.pollEverySec,
            }
          : null,
        error: step.error
          ? { message: step.error.message, hint: step.error.hint ?? null }
          : null,
      })),
    })),
    gates: state.gates.map((gate) => ({
      id: gate.id,
      label: gate.label,
      consequence: gate.consequence,
      status: gate.status,
      decidedAt: gate.decidedAt ?? null,
      choice: gate.choice ?? null,
    })),
    openItems: state.openItems.map((item) => ({
      id: item.id,
      label: item.label,
      severity: item.severity,
      resolvedAt: item.resolvedAt ?? null,
    })),
    rollbacks: state.rollbacks.map((entry) => ({ stepId: entry.stepId, at: entry.at })),
  };
}

export async function getRelocationState(): Promise<RelocationView> {
  await requirePlatformOwner();

  let raw: string;
  try {
    raw = await readFile(path.join(process.cwd(), RELOCATION_STATE_FILE), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return { kind: 'no-run' };
    return { kind: 'unreadable' };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Mid-write race or truncation — the page shows "refresh in a moment".
    return { kind: 'unreadable' };
  }

  const parsed = parseRelocationState(json);
  if (!parsed.ok) {
    return parsed.reason === 'unsupported-version'
      ? { kind: 'unsupported-version' }
      : { kind: 'unreadable' };
  }

  return { kind: 'ok', run: toView(parsed.state, new Date()) };
}
