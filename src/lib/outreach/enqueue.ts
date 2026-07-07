// The step SCHEDULER + the step EXECUTION orchestrator (§12 FINAL M1). Kept free
// of `server-only` / DB / pg imports so it stays unit-testable: `enqueueStepJob`
// takes `boss`, and `runStepExecution` takes ALL side effects as injected deps
// (reserve / send / resolve / release / retry-meta). The worker wires the real
// implementations (outreach-engine RPC wrappers, the WhatsApp send, and the
// worker-only pgboss-meta adapter).
//
// Two deterministic identities (§F.1 — do NOT unify):
//   mode 'plan' | 'replan' → detId(campaign, contact, step, planRev)
//   mode 'defer'           → deferId(campaign, contact, step, planRev, targetSlotMs)
// The id is RECOMPUTED per mode; nothing stores or trusts a sourceJobId. The
// anchor is recorded by ensureCurrentStep BEFORE this enqueue (intent-first), so
// enqueueStepJob is a pure id + boss.send with the uniform retry policy. A null
// return means the deterministic job already exists (idempotent) — expected.

import { PgBoss } from 'pg-boss';

import { QUEUES, STEP_RETRY, type OutreachStepJob, type OutreachStepMode } from '@/lib/queue/queues';
import { detId, deferId } from '@/lib/outreach/schedule';
import type { DeliveryOutcome } from '@/lib/whatsapp/client';

export interface EnqueueStepArgs {
  mode: OutreachStepMode;
  campaignId: string;
  contactId: string;
  eventId: string;
  stepIndex: number;
  planRev: string;
  /** the STABLE plan-anchor slot (deferId key + reserve CAS value). */
  targetSlotMs: number;
  /** when the job actually runs (startAfter) — max(targetSlot, now) for a send. */
  runAtMs: number;
}

// Enqueue ONE step job at its deterministic id. No anchor write here (the caller
// recorded it). Idempotent: a duplicate id → boss.send returns null → no-op.
export async function enqueueStepJob(boss: PgBoss, args: EnqueueStepArgs): Promise<void> {
  const { mode, campaignId, contactId, eventId, stepIndex, planRev, targetSlotMs, runAtMs } = args;
  const slot = Math.round(targetSlotMs);
  const id =
    mode === 'defer'
      ? deferId(campaignId, contactId, stepIndex, planRev, slot)
      : detId(campaignId, contactId, stepIndex, planRev);
  const data: OutreachStepJob = {
    campaignId,
    contactId,
    eventId,
    stepIndex,
    planRev,
    mode,
    targetSlotMs: slot,
  };
  await boss.send(QUEUES.step, data, {
    id,
    startAfter: new Date(Math.round(runAtMs)),
    ...STEP_RETRY,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION — reserve → send → resolve, for the job that fired on a 'send'
// decision. All side effects injected (see module header). The send classifies
// into a StepSendResult; the RPC verdicts drive advance / retry / recovery.
// ─────────────────────────────────────────────────────────────────────────────

// The classified result of building + performing one step's outreach.
export type StepSendResult =
  | DeliveryOutcome // accepted | definitely_not_sent | unknown
  | { kind: 'skip'; reason: string } // config/template integrity → advance-skip
  | { kind: 'terminal'; reason: string } // opt-out / no consent → terminalize
  | { kind: 'advance'; reason: string }; // dispatched (call request) → advance

export interface StepExecutionDeps {
  reserve: (a: {
    campaignId: string;
    contactId: string;
    stepIndex: number;
    planRev: string;
    plannedAtIso: string;
    jobId: string;
  }) => Promise<'reserved' | 'stale' | 'error'>;
  send: () => Promise<StepSendResult>;
  resolve: (a: {
    campaignId: string;
    contactId: string;
    stepIndex: number;
    planRev: string;
    jobId: string | null;
    advance: boolean;
    terminalStatus: string | null;
    reason: string;
    eventId: string;
    auditId: string;
  }) => Promise<'resolved' | 'stale' | 'error'>;
  release: (a: {
    campaignId: string;
    contactId: string;
    stepIndex: number;
    planRev: string;
    jobId: string;
  }) => Promise<'released' | 'stale' | 'error'>;
  getRetryMeta: (
    jobId: string,
  ) => Promise<{ state: string; retryCount: number; retryLimit: number } | null>;
  auditId: (reason: string) => string;
  // Read-only terminal re-check (removal / channel-consent) for crash recovery —
  // NO send. Returns the terminal reason, or null when the step is not terminal.
  recheckTerminal: () => Promise<{ reason: string } | null>;
}

export interface StepExecutionArgs {
  campaignId: string;
  contactId: string;
  eventId: string;
  stepIndex: number;
  planRev: string;
  /** the anchor's planned_at (= new Date(targetSlotMs).toISOString()). */
  plannedAtIso: string;
  jobId: string;
  /** true when THIS job already owns the reservation → a crash-recovery run. */
  alreadyReserved: boolean;
}

export async function runStepExecution(
  deps: StepExecutionDeps,
  args: StepExecutionArgs,
): Promise<void> {
  const { campaignId, contactId, eventId, stepIndex, planRev, plannedAtIso, jobId } = args;

  const resolve = (opts: {
    advance: boolean;
    terminalStatus: string | null;
    reason: string;
    jobId: string | null;
  }) =>
    deps.resolve({
      campaignId,
      contactId,
      stepIndex,
      planRev,
      eventId,
      advance: opts.advance,
      terminalStatus: opts.terminalStatus,
      reason: opts.reason,
      jobId: opts.jobId,
      auditId: deps.auditId(opts.reason),
    });

  // RECOVERY: a prior run of THIS job reserved + (maybe) sent, then its resolve
  // failed / it crashed. NEVER resend. Re-check the terminal conditions FIRST
  // (read-only, no send): a failed terminalize (opt-out / no-consent) must
  // RE-TERMINALIZE, not convert into a blind advance. Otherwise advance once
  // (at-most-once) — a prior real send may already have happened. Both branches
  // are non-sending, so at-most-once holds regardless.
  if (args.alreadyReserved) {
    const term = await deps.recheckTerminal();
    const res = term
      ? await resolve({ advance: false, terminalStatus: 'stopped', reason: term.reason, jobId })
      : await resolve({ advance: true, terminalStatus: null, reason: 'dispatch_outcome_unknown', jobId });
    if (res === 'error') throw new Error('recovery_resolve_failed');
    return;
  }

  // Claim the cursor step for this attempt. 0 rows (stale) → a concurrent job
  // owns it, or the cursor/plan moved → do NOT send.
  const reserved = await deps.reserve({
    campaignId,
    contactId,
    stepIndex,
    planRev,
    plannedAtIso,
    jobId,
  });
  if (reserved !== 'reserved') return;

  const outcome = await deps.send();

  switch (outcome.kind) {
    case 'skip': {
      // Template/config integrity — advance-skip (still holding the reservation).
      const res = await resolve({ advance: true, terminalStatus: null, reason: outcome.reason, jobId });
      if (res === 'error') throw new Error('resolve_after_skip_failed');
      return;
    }
    case 'terminal': {
      const res = await resolve({ advance: false, terminalStatus: 'stopped', reason: outcome.reason, jobId });
      if (res === 'error') throw new Error('resolve_after_terminal_failed');
      return;
    }
    case 'advance': {
      const res = await resolve({ advance: true, terminalStatus: null, reason: outcome.reason, jobId });
      if (res === 'error') throw new Error('resolve_after_advance_failed');
      return;
    }
    case 'accepted': {
      const res = await resolve({ advance: true, terminalStatus: null, reason: 'sent', jobId });
      // §12.9.5: after an accepted send, a resolve failure must THROW (never
      // release) → the same J re-runs → sees dispatched=J → recovery-advance,
      // no resend (possible sent-count under-count, never a double send).
      if (res === 'error') throw new Error('resolve_after_accepted_failed');
      return;
    }
    case 'definitely_not_sent': {
      const meta = await deps.getRetryMeta(jobId);
      if (meta && meta.retryCount < meta.retryLimit) {
        // A retry attempt remains → release the reservation + throw so pg-boss
        // re-runs the SAME job J (re-reserve + re-send).
        await deps.release({ campaignId, contactId, stepIndex, planRev, jobId });
        throw new Error(`definitely_not_sent_retry:${outcome.reason}`);
      }
      // Final attempt (or retry meta unavailable → treat as final to bound the
      // loop): advance-skip provider_failure. Dead-letter is the crash fallback.
      const res = await resolve({ advance: true, terminalStatus: null, reason: 'provider_failure', jobId });
      if (res === 'error') throw new Error('resolve_after_provider_failure_failed');
      return;
    }
    case 'unknown': {
      // Delivery UNCERTAIN → NEVER resend; advance at-most-once (guarded to J).
      const res = await resolve({ advance: true, terminalStatus: null, reason: 'dispatch_outcome_unknown', jobId });
      if (res === 'error') throw new Error('resolve_after_unknown_failed');
      return;
    }
  }
}
