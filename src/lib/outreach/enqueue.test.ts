import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enqueueStepJob,
  runStepExecution,
  type StepExecutionArgs,
  type StepExecutionDeps,
  type StepSendResult,
} from './enqueue';
import { detId, deferId } from './schedule';
import { QUEUES, type OutreachStepJob } from '@/lib/queue/queues';

// enqueueStepJob is a pure id + boss.send (the anchor is recorded upstream). A
// minimal boss stub captures the (queue, data, options) triple.
type SendArgs = [string, OutreachStepJob, Record<string, unknown>];
function fakeBoss() {
  const send = vi.fn<(...a: SendArgs) => Promise<string>>(async () => 'ok');
  return { boss: { send } as unknown as import('pg-boss').PgBoss, send };
}

const ENQ = {
  campaignId: '11111111-1111-4111-8111-111111111111',
  contactId: '22222222-2222-4222-8222-222222222222',
  eventId: '33333333-3333-4333-8333-333333333333',
  stepIndex: 2,
  planRev: 'a'.repeat(64),
};

describe('enqueueStepJob — deterministic id BY MODE, IDs-only payload', () => {
  it("mode 'plan' → detId; payload carries IDs + planRev/mode/targetSlotMs ONLY (no PII)", async () => {
    const { boss, send } = fakeBoss();
    const targetSlotMs = 1_800_000_000_123.7; // deliberately fractional
    await enqueueStepJob(boss, {
      mode: 'plan',
      ...ENQ,
      targetSlotMs,
      runAtMs: 1_800_000_000_500.9,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [queue, data, opts] = send.mock.calls[0];
    expect(queue).toBe(QUEUES.step);
    // IDs-only payload — never a phone/name/body/token.
    expect(data).toEqual({
      campaignId: ENQ.campaignId,
      contactId: ENQ.contactId,
      eventId: ENQ.eventId,
      stepIndex: ENQ.stepIndex,
      planRev: ENQ.planRev,
      mode: 'plan',
      targetSlotMs: 1_800_000_000_124, // Math.round
    });
    expect(opts.id).toBe(detId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev));
    expect(opts.startAfter).toEqual(new Date(1_800_000_000_501)); // round(runAtMs)
    expect(opts.retryLimit).toBe(3);
    expect(opts.deadLetter).toBe(QUEUES.dead);
  });

  it("mode 'replan' also uses detId (the plan identity is unchanged)", async () => {
    const { boss, send } = fakeBoss();
    await enqueueStepJob(boss, { mode: 'replan', ...ENQ, targetSlotMs: 5_000, runAtMs: 5_000 });
    expect(send.mock.calls[0][2].id).toBe(
      detId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev),
    );
    expect(send.mock.calls[0][1].mode).toBe('replan');
  });

  it("mode 'defer' → deferId keyed on the ROUNDED targetSlotMs (a fresh identity)", async () => {
    const { boss, send } = fakeBoss();
    await enqueueStepJob(boss, { mode: 'defer', ...ENQ, targetSlotMs: 7_777.4, runAtMs: 7_777.4 });
    const [, data, opts] = send.mock.calls[0];
    expect(data.mode).toBe('defer');
    expect(data.targetSlotMs).toBe(7_777);
    expect(opts.id).toBe(deferId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev, 7_777));
    // The defer identity is DISTINCT from the plan detId for the same step.
    expect(opts.id).not.toBe(detId(ENQ.campaignId, ENQ.contactId, ENQ.stepIndex, ENQ.planRev));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runStepExecution — reserve → send → resolve, ALL side effects injected. These
// pin the §12 FINAL certainty taxonomy: at-most-once, unknown never resends, a
// definite failure retries until exhaustion then advance-skips (NOT dead-letter).
// ─────────────────────────────────────────────────────────────────────────────
const JOB = 'job-uuid-abc';

function makeDeps(overrides: Partial<StepExecutionDeps> = {}) {
  const reserve = vi.fn(async () => 'reserved' as const);
  const send = vi.fn(async () => ({ kind: 'accepted', providerId: 'wamid.1' }) as StepSendResult);
  const resolve = vi.fn(async () => 'resolved' as const);
  const release = vi.fn(async () => 'released' as const);
  const getRetryMeta = vi.fn(async () => ({ state: 'active', retryCount: 0, retryLimit: 3 }));
  const auditId = vi.fn((reason: string) => `audit:${reason}`);
  const recheckTerminal = vi.fn(async (): Promise<{ reason: string } | null> => null);
  const deps: StepExecutionDeps = {
    reserve, send, resolve, release, getRetryMeta, auditId, recheckTerminal,
    ...overrides,
  } as StepExecutionDeps;
  return { deps, reserve, send, resolve, release, getRetryMeta, auditId, recheckTerminal };
}

const ARGS: StepExecutionArgs = {
  campaignId: ENQ.campaignId,
  contactId: ENQ.contactId,
  eventId: ENQ.eventId,
  stepIndex: ENQ.stepIndex,
  planRev: ENQ.planRev,
  plannedAtIso: '2026-07-13T08:00:00.000Z',
  jobId: JOB,
  alreadyReserved: false,
};

beforeEach(() => vi.clearAllMocks());

describe('runStepExecution — reservation + certainty taxonomy', () => {
  it('accepted → resolve{advance, reason:sent, jobId}; reserves once, sends once', async () => {
    const { deps, reserve, send, resolve } = makeDeps();
    await runStepExecution(deps, ARGS);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: true, terminalStatus: null, reason: 'sent', jobId: JOB }),
    );
  });

  it('a STALE reservation → NO send, NO resolve (a concurrent job owns the cursor)', async () => {
    const { deps, send, resolve } = makeDeps({ reserve: vi.fn(async () => 'stale' as const) });
    await runStepExecution(deps, ARGS);
    expect(send).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('definitely_not_sent with a retry LEFT → release + THROW (pg-boss re-runs the same J)', async () => {
    const { deps, release, resolve } = makeDeps({
      send: vi.fn(async () => ({ kind: 'definitely_not_sent', reason: 'provider_rejected' }) as StepSendResult),
      getRetryMeta: vi.fn(async () => ({ state: 'active', retryCount: 1, retryLimit: 3 })),
    });
    await expect(runStepExecution(deps, ARGS)).rejects.toThrow(/definitely_not_sent_retry/);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB }));
    expect(resolve).not.toHaveBeenCalled(); // no advance while a retry remains
  });

  it('definitely_not_sent on the FINAL attempt (retryCount=retryLimit) → advance-skip provider_failure, NO throw, NO dead-letter', async () => {
    const { deps, release, resolve } = makeDeps({
      send: vi.fn(async () => ({ kind: 'definitely_not_sent', reason: 'provider_rejected' }) as StepSendResult),
      getRetryMeta: vi.fn(async () => ({ state: 'active', retryCount: 3, retryLimit: 3 })),
    });
    await expect(runStepExecution(deps, ARGS)).resolves.toBeUndefined(); // returns, never throws
    expect(release).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: true, reason: 'provider_failure', jobId: JOB }),
    );
  });

  it('definitely_not_sent with retry meta UNAVAILABLE (null) → treated as final → advance-skip, no throw', async () => {
    const { deps, resolve } = makeDeps({
      send: vi.fn(async () => ({ kind: 'definitely_not_sent', reason: 'provider_rejected' }) as StepSendResult),
      getRetryMeta: vi.fn(async () => null),
    });
    await expect(runStepExecution(deps, ARGS)).resolves.toBeUndefined();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: true, reason: 'provider_failure' }),
    );
  });

  it('unknown → resolve{advance, dispatch_outcome_unknown}; NEVER releases, NEVER reads retry meta (no resend)', async () => {
    const { deps, release, getRetryMeta, resolve } = makeDeps({
      send: vi.fn(async () => ({ kind: 'unknown', reason: 'send_threw' }) as StepSendResult),
    });
    await runStepExecution(deps, ARGS);
    expect(release).not.toHaveBeenCalled();
    expect(getRetryMeta).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: true, reason: 'dispatch_outcome_unknown', jobId: JOB }),
    );
  });

  it('a send-integrity skip → advance-skip with the exact reason', async () => {
    const { deps, resolve } = makeDeps({
      send: vi.fn(async () => ({ kind: 'skip', reason: 'template_missing' }) as StepSendResult),
    });
    await runStepExecution(deps, ARGS);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: true, terminalStatus: null, reason: 'template_missing' }),
    );
  });

  it('a terminal outcome (opt-out / no consent) → resolve{advance:false, terminalStatus:stopped}', async () => {
    const { deps, resolve } = makeDeps({
      send: vi.fn(async () => ({ kind: 'terminal', reason: 'removal_requested' }) as StepSendResult),
    });
    await runStepExecution(deps, ARGS);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: false, terminalStatus: 'stopped', reason: 'removal_requested' }),
    );
  });

  it('a call-dispatch advance → resolve{advance, reason:call_requested}', async () => {
    const { deps, resolve } = makeDeps({
      send: vi.fn(async () => ({ kind: 'advance', reason: 'call_requested' }) as StepSendResult),
    });
    await runStepExecution(deps, ARGS);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: true, reason: 'call_requested' }),
    );
  });

  it('accepted + a FAILED resolve → THROW (never release) so the SAME J recovers (no double send)', async () => {
    const { deps, release } = makeDeps({ resolve: vi.fn(async () => 'error' as const) });
    await expect(runStepExecution(deps, ARGS)).rejects.toThrow(/resolve_after_accepted_failed/);
    expect(release).not.toHaveBeenCalled();
  });

  it('alreadyReserved (crash recovery) → advance-once as unknown, NEVER re-reserves or re-sends', async () => {
    const { deps, reserve, send, resolve } = makeDeps();
    await runStepExecution(deps, { ...ARGS, alreadyReserved: true });
    expect(reserve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ advance: true, reason: 'dispatch_outcome_unknown', jobId: JOB }),
    );
  });

  it('recovery resolve failure → THROW (the same J re-runs and recovers again)', async () => {
    const { deps } = makeDeps({ resolve: vi.fn(async () => 'error' as const) });
    await expect(runStepExecution(deps, { ...ARGS, alreadyReserved: true })).rejects.toThrow(
      /recovery_resolve_failed/,
    );
  });

  // REGRESSION (terminal-recovery defect) — FULL same-J sequence. A prior TERMINAL
  // resolve (opt-out / no-consent) that hit a transport error must NOT become a
  // blind advance when the SAME job re-runs. Run 1 reserves + sends (terminal) +
  // fails to resolve (throws). Run 2 (same jobId, alreadyReserved) re-checks the
  // terminal condition and RE-TERMINALIZES — no second reserve, no second send
  // (no WhatsApp / no call), and NEVER advance:true.
  it.each(['removal_requested', 'no_whatsapp_consent'])(
    'full same-J recovery (%s): run1 throws, run2 re-terminalizes; reserve/send once, never advance:true',
    async (reason) => {
      const reserve = vi.fn(async () => 'reserved' as const);
      const send = vi.fn(async () => ({ kind: 'terminal', reason }) as StepSendResult);
      let resolveN = 0;
      const resolve = vi.fn(async () => (++resolveN === 1 ? 'error' : 'resolved') as 'resolved' | 'error');
      const recheckTerminal = vi.fn(async () => ({ reason }));
      const { deps } = makeDeps({ reserve, send, resolve, recheckTerminal });

      // RUN 1 — alreadyReserved=false → reserve → send terminal → resolve 'error' → throw.
      await expect(runStepExecution(deps, { ...ARGS, alreadyReserved: false })).rejects.toThrow(
        /resolve_after_terminal_failed/,
      );
      // RUN 2 — same jobId, alreadyReserved=true → recheckTerminal → resolve 'resolved'.
      await runStepExecution(deps, { ...ARGS, alreadyReserved: true });

      expect(reserve).toHaveBeenCalledTimes(1); // run 1 only
      expect(send).toHaveBeenCalledTimes(1); // run 1 only — no re-send in recovery
      expect(recheckTerminal).toHaveBeenCalledTimes(1); // run 2 recovery
      // the SECOND resolve (recovery) re-terminalizes with the SAME reason.
      expect(resolve).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ advance: false, terminalStatus: 'stopped', reason, jobId: JOB }),
      );
      expect(resolve).not.toHaveBeenCalledWith(expect.objectContaining({ advance: true }));
    },
  );
});
