import { describe, expect, it, vi } from 'vitest';

import { WORKFLOW_RUN_EXPIRE_SECONDS } from '@/lib/queue/queues';
import {
  DEFAULT_NODE_ACTIVITY_PROFILE,
  MAX_NODE_TIMEOUT_MS,
  NODE_ACTIVITY_PROFILES,
  nodeBudgetMs,
  resolveBudgetMs,
} from '@/lib/workflow/engine/node-budgets';
import { createActivityRunner } from '@/lib/workflow/engine/activity-runner';
import { STEP_LEASE_MS, type StepClaim, type StepLedgerPort } from '@/lib/workflow/engine/ports';

// THE THREE TIMERS, and the order between them.
//
// ⚠️ THIS IS THE TEST THE COMMENTS CANNOT REPLACE. The three live in three
// different files — a node budget in the engine, `expireInSeconds` in the queue
// constants, `STEP_LEASE_MS` in the ports — and two of them were the same number
// by INHERITANCE, not by choice: pg-boss defaults `expireInSeconds` to 900
// (dist/plans.js `QUEUE_DEFAULTS`), the workflow queue never set it, and
// `STEP_LEASE_MS` is 15 minutes. Nothing anywhere said they were related, so
// nothing noticed.
//
// What the collision did: at 900s pg-boss DELETES the active job and re-inserts
// it as `retry` (`failJobsByTimeout`), with the first backoff ~1-2s away
// (`GREATEST(retry_delay,1)`, retry_count 0). The step row claimed at t=0 crosses
// its lease at the same instant — so the retry RECLAIMS a node the first handler
// may still be inside, and runs its side effect a second time. Nothing stops it:
// `singletonKey` constrains nothing on a `standard` queue.
//
// The shape is upstream's. WorkflowBuilder runs this same `runGraph` on Temporal,
// where each node is an activity with its own `startToCloseTimeout` and the
// package ships `DEFAULT_NODE_ACTIVITY_PROFILE` plus a per-type map. pg-boss has
// no activities, so the budget is enforced around the handler instead — but the
// rule that every node has an explicit ceiling is theirs.

const EXPIRE_MS = WORKFLOW_RUN_EXPIRE_SECONDS * 1000;

describe('the budget chain', () => {
  it('⚠️ node budget < queue expiry < step lease', async () => {
    // Each gap does a different job:
    //   node < expiry — a node always ends on its OWN terms before pg-boss takes
    //                   the job from it, so the step row is 'failed' (reclaimable)
    //                   rather than 'running' (contended) when the retry lands.
    //   expiry < lease — a retry arriving after a timeout meets a step row still
    //                   inside its lease, reads `in_flight`, and comes back as
    //                   `contended` instead of re-running the node.
    expect(MAX_NODE_TIMEOUT_MS).toBeLessThan(EXPIRE_MS);
    expect(EXPIRE_MS).toBeLessThan(STEP_LEASE_MS);
  });

  it('⚠️ the two that used to collide are no longer equal', async () => {
    // The regression this whole change exists for. If these are ever the same
    // number again, a retry reclaims a live step in the same second the previous
    // attempt was given up on.
    expect(EXPIRE_MS).not.toBe(STEP_LEASE_MS);
  });

  it('every declared profile is inside the ceiling and positive', async () => {
    for (const [type, profile] of Object.entries(NODE_ACTIVITY_PROFILES)) {
      expect(profile, type).toBeDefined();
      expect(profile!.timeoutMs, type).toBeGreaterThan(0);
      expect(profile!.timeoutMs, type).toBeLessThanOrEqual(MAX_NODE_TIMEOUT_MS);
    }
  });

  it('the default is explicit and inside the ceiling', async () => {
    // Upstream's rule, for upstream's reason: what you fall back to when a type
    // has no entry must be a number someone chose. Theirs is a 10-minute
    // `startToCloseTimeout`; the alternative in both systems is no bound at all.
    expect(DEFAULT_NODE_ACTIVITY_PROFILE.timeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_NODE_ACTIVITY_PROFILE.timeoutMs).toBeLessThanOrEqual(MAX_NODE_TIMEOUT_MS);
  });
});

describe('nodeBudgetMs', () => {
  it('reads the declared profile', async () => {
    expect(nodeBudgetMs('action.import_guest_list')).toBe(300_000);
    expect(nodeBudgetMs('logic.condition')).toBe(5_000);
  });

  it('falls back to the default for an unlisted type, and never to "no bound"', async () => {
    expect(nodeBudgetMs('action.something_added_tomorrow')).toBe(
      DEFAULT_NODE_ACTIVITY_PROFILE.timeoutMs,
    );
  });

  it('⚠️ refuses a nonsense entry instead of honouring it', async () => {
    // A zero would time every node out instantly; an Infinity would restore
    // exactly the unbounded behaviour this replaced. Both are typos that present
    // as something else entirely, so the value is validated at the read.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_NODE_TIMEOUT_MS + 1]) {
      expect(resolveBudgetMs({ timeoutMs: bad }), String(bad)).toBe(
        DEFAULT_NODE_ACTIVITY_PROFILE.timeoutMs,
      );
    }
    // And a good one is returned untouched.
    expect(resolveBudgetMs({ timeoutMs: 1_234 })).toBe(1_234);
  });

  it('the table is frozen — a budget cannot be rewritten at run time', async () => {
    expect(Object.isFrozen(NODE_ACTIVITY_PROFILES)).toBe(true);
  });
});

// The budget ENFORCED, not merely declared.
describe('a node that overruns its budget', () => {
  it('⚠️ fails the step so a retry can take the node over', async () => {
    vi.useFakeTimers();
    try {
      const failed: string[] = [];
      const runner = createActivityRunner({
        runId: 'run-1',
        workflowId: 'wf-1',
        trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '' },
        ledger: {
          async claimStep(): Promise<StepClaim> {
            return { kind: 'claimed' };
          },
          async completeStep() {},
          async failStep({ nodeId }: { nodeId: string }) {
            failed.push(nodeId);
          },
          async beginWait() {},
        } as unknown as StepLedgerPort,
        guests: {
          // Never settles — the shape a hung provider call has.
          async notifyTeam() {
            return new Promise<never>(() => {});
          },
        } as never,
        alerts: {
          async notifyTeam() {
            return new Promise<never>(() => {});
          },
        } as never,
        webhook: { post: async () => ({ ok: true, status: 200 }) } as never,
      });

      const promise = runner.executeNode(
        {
          id: 'n1',
          type: 'action.notify_team',
          config: { level: 'info', title: 'x' },
        } as never,
        {} as never,
      );
      const assertion = expect(promise).rejects.toThrow(/מגבלת הזמן/);
      await vi.advanceTimersByTimeAsync(nodeBudgetMs('action.notify_team') + 10);
      await assertion;

      // ⚠️ `failStep`, NOT `beginWait` and not silence. A row left 'running' is
      // held by the 15-minute lease, so the retry this timeout earns would read
      // `in_flight` and come back contended until the lease expired. 'failed' is
      // reclaimable at once (`takeOverFailedRow`), which is the point of ending
      // the attempt at all.
      expect(failed).toEqual(['n1']);
    } finally {
      vi.useRealTimers();
    }
  });
});
