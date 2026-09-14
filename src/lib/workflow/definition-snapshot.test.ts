import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { handleWorkflowRun } from './enqueue';

// A run that parks at `logic.wait` must resume on the definition it STARTED
// with — not on the one the owner edited while it slept.
//
// ⚠️ WHY THE LEDGER IS NOT ENOUGH, which is the thing that makes this subtle.
// `workflow_run_steps` replays finished steps by node id, so nothing already
// done repeats. But a node ADDED BEFORE the wait has no ledger row at all: it
// reads as never-reached and RUNS on resume. The protection people assume they
// have covers the steps that happened, not the steps that appeared.

const WAITED = { nodes: [{ id: 'old' }] };
const EDITED_SINCE = { nodes: [{ id: 'old' }, { id: 'added-while-asleep' }] };

describe('which definition a run executes', () => {
  it.each([
    {
      what: '⚠️ a PARKED run resumes on its snapshot, not on today’s diagram',
      status: 'waiting' as const,
      expected: WAITED,
    },
    {
      what: 'a fresh run reads the CURRENT diagram — editing before it starts is meant to count',
      status: 'pending' as const,
      expected: EDITED_SINCE,
    },
  ])('$what', async ({ status, expected }) => {
    vi.resetModules();
    const runWorkflow = vi.fn(async (_args: { storedDefinition: unknown }) => ({
      status: 'completed' as const,
    }));
    vi.doMock('./engine/run-workflow', () => ({ runWorkflow }));
    vi.doMock('./store', () => ({
      createExecutionLog: () => ({}),
      createRunStore: () => ({ setRunStatus: async () => {} }),
      createStepLedger: () => ({}),
      loadRunForExecution: async () => ({
        runId: 'r1',
        workflowId: 'w1',
        status,
        triggerPayload: {},
        storedDefinition: EDITED_SINCE,
        definitionSnapshot: WAITED,
      }),
    }));
    vi.doMock('@/lib/url', () => ({ getAppOrigin: async () => 'https://x.test' }));

    const { handleWorkflowRun: handler } = await import('./enqueue');
    await handler({ runId: 'r1' } as Parameters<typeof handleWorkflowRun>[0]);

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ storedDefinition: expected }),
    );
  });

  it('⚠️ a run created BEFORE the column falls back to the live definition', async () => {
    // The column is nullable and nothing was backfilled, so every run already in
    // flight when the migration landed has no snapshot. Those must behave exactly
    // as they did before — a null must never be read as "an empty workflow".
    vi.resetModules();
    const runWorkflow = vi.fn(async (_args: { storedDefinition: unknown }) => ({
      status: 'completed' as const,
    }));
    vi.doMock('./engine/run-workflow', () => ({ runWorkflow }));
    vi.doMock('./store', () => ({
      createExecutionLog: () => ({}),
      createRunStore: () => ({ setRunStatus: async () => {} }),
      createStepLedger: () => ({}),
      loadRunForExecution: async () => ({
        runId: 'r1',
        workflowId: 'w1',
        status: 'waiting',
        triggerPayload: {},
        storedDefinition: EDITED_SINCE,
        definitionSnapshot: null,
      }),
    }));
    vi.doMock('@/lib/url', () => ({ getAppOrigin: async () => 'https://x.test' }));

    const { handleWorkflowRun: handler } = await import('./enqueue');
    await handler({ runId: 'r1' } as Parameters<typeof handleWorkflowRun>[0]);

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ storedDefinition: EDITED_SINCE }),
    );
  });
});
