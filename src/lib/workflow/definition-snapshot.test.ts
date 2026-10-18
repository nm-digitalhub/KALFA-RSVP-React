import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// ⚠️ `import type`, AND THAT IS THE WHOLE FIX FOR A FLAKY TEST.
//
// This symbol is used ONLY in type position (`Parameters<typeof …>`, twice);
// the value comes from the dynamic `await import('./enqueue')` below, after
// `vi.resetModules()` + `vi.doMock`. As a VALUE import it eagerly loaded the
// real `./enqueue` — and with it `run-workflow`, the integration runtime, the
// pg-boss queues, `guest-actions`, `wake-store`, `team-alerts` and
// `outbound-webhook` — into the registry BEFORE any mock was declared.
//
// MEASURED 2026-09-22: this file passed on its own and failed once inside a full
// 6,758-test run, then passed on the next full run. That is the signature of
// registry state shared with whatever else landed in the same worker, not of a
// bug in the code under test. A type-only import emits nothing, so the mocked
// dynamic import is the only thing that ever loads the module.
import type { handleWorkflowRun } from './enqueue';

// A run that parks at `logic.wait` must resume on the definition it STARTED
// with — not on the one the owner edited while it slept.
//
// ⚠️ WHY THE LEDGER IS NOT ENOUGH, which is the thing that makes this subtle.
// `workflow_run_steps` replays finished steps by node id, so nothing already
// done repeats. But a node ADDED BEFORE the wait has no ledger row at all: it
// reads as never-reached and RUNS on resume. The protection people assume they
// have covers the steps that happened, not the steps that appeared.

// ⚠️ THE TIMEOUT IS FOR THE COLD IMPORT, NOT FOR THE ASSERTIONS. The first test to reach `await import('./enqueue')` loads that
// module's real graph (the integration runtime, the queues, the stores' callers) after `vi.resetModules()`. MEASURED 2026-10-18:
// ~1 s when the file runs alone, 6.6 s for the file (the first test over the default 5 s) inside the full 12,922-test run, where
// the same worker pool is busy transforming thousands of other files. The assertions never changed; only the clock did.
const COLD_IMPORT_TIMEOUT_MS = 30_000;

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
  }, COLD_IMPORT_TIMEOUT_MS);

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
  }, COLD_IMPORT_TIMEOUT_MS);
});
