import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { STEP_HANDLERS, type StepContext } from './index';

// The AI step.
//
// ⚠️ THE PROPERTY THIS FILE EXISTS FOR is the last test: a dry run must not
// reach a model. The editor's "הרצת בדיקה" panel promises the run changes
// nothing — and a model call changes no row, but it COSTS money and returns
// prose an owner would read as a real answer. That holds only because the
// handler goes through `ctx.deps.ai`, which the dry run swaps for a recording
// stub; a future edit that spawned the CLI here would bill from a test button.

function ctxWith(run: unknown): StepContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    nodeId: 'node-1',
    trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '' },
    deps: { ai: { run } } as unknown as StepContext['deps'],
  } as StepContext;
}

const ANSWER = { text: 'תשובה', costUsd: 0.004, sessionId: 'sess-1' };
const handler = STEP_HANDLERS['action.ai_agent'];

describe('what reaches the model', () => {
  it('passes the prompt, model and turn ceiling through', async () => {
    const run = vi.fn().mockResolvedValue(ANSWER);
    await handler(
      { systemPrompt: 'סכם את ההודעה', model: 'sonnet', maxTurns: 6 },
      ctxWith(run),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'סכם את ההודעה', model: 'sonnet', maxTurns: 6 }),
    );
  });

  it('refuses a blank prompt rather than asking the model nothing', async () => {
    const run = vi.fn();
    await expect(handler({ systemPrompt: '   ', model: 'haiku' }, ctxWith(run))).rejects.toThrow(
      /הנחיה/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a model outside the catalogue rather than passing it to the CLI', async () => {
    const run = vi.fn();
    await expect(
      handler({ systemPrompt: 'x', model: 'gpt-5' }, ctxWith(run)),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('⚠️ CLAMPS the turn ceiling instead of failing a run over a slider', async () => {
    // A value outside the range is a control that moved, not a step nobody
    // configured. The CEILING is what matters — it is what stops a loop — so it
    // is enforced, but a run is not lost to it.
    const run = vi.fn().mockResolvedValue(ANSWER);
    for (const [given, expected] of [[0, 1], [999, 20], [undefined, 4]] as const) {
      run.mockClear();
      await handler({ systemPrompt: 'x', model: 'haiku', maxTurns: given }, ctxWith(run));
      expect(run.mock.calls[0][0].maxTurns, String(given)).toBe(expected);
    }
  });
});

describe('⚠️ tool rows carry NAMES, never credentials', () => {
  it('sends only the tool name, and drops blank rows', async () => {
    const run = vi.fn().mockResolvedValue(ANSWER);
    await handler(
      {
        systemPrompt: 'x',
        model: 'haiku',
        tools: [
          { tool: ' guests.lookup ', description: 'מוצא אורח' },
          { tool: '', description: 'שורה ריקה' },
          { description: 'בלי שם כלי' },
        ],
      },
      ctxWith(run),
    );
    expect(run.mock.calls[0][0].tools).toEqual(['guests.lookup']);
  });

  it('⚠️ NEVER forwards `apiKey`, even when the row carries one', async () => {
    // `apiKey` is part of the SDK control's fixed row shape and cannot be
    // removed from it — the vendor's own docs call the surface "specific to the
    // demo's AI-agent node". A diagram is EXPORTABLE, and the editor's own menu
    // puts one in a copyable box, so anything an owner types there must go
    // nowhere. This is the test that says so.
    const run = vi.fn().mockResolvedValue(ANSWER);
    await handler(
      { systemPrompt: 'x', model: 'haiku', tools: [{ tool: 'a', apiKey: 'sk-live-REAL' }] },
      ctxWith(run),
    );
    const sent = JSON.stringify(run.mock.calls[0][0]);
    expect(sent).not.toContain('sk-live-REAL');
    expect(sent).not.toContain('apiKey');
  });
});

describe('what the step publishes', () => {
  it('returns the answer, the cost and the session id', async () => {
    const run = vi.fn().mockResolvedValue(ANSWER);
    const result = await handler({ systemPrompt: 'x', model: 'haiku' }, ctxWith(run));
    expect(result.output).toEqual({ text: 'תשובה', costUsd: 0.004, sessionId: 'sess-1' });
  });

  it('⚠️ does NOT branch on the answer — that is a condition node’s job', async () => {
    // A step that interpreted the text would be deciding, silently and
    // differently every run, what counts as agreement. Branching stays visible
    // on the canvas: `{{nodes.<id>.text}}` into a `logic.condition`.
    const run = vi.fn().mockResolvedValue({ ...ANSWER, text: 'לא' });
    const result = await handler({ systemPrompt: 'x', model: 'haiku' }, ctxWith(run));
    expect(result).not.toHaveProperty('nextPort');
  });
});

describe('⚠️ the step layer never reaches a model except through the port', () => {
  // THE ACTUAL GUARANTEE, and a mock cannot express it: a handler that spawned
  // the CLI itself would pass every test above while billing a card from the
  // editor's test button — the dry run swaps PORTS, so a direct call walks
  // straight past it. Source-scanned for the same reason
  // sumit-accounting.test.ts scans.
  it('steps/index.ts spawns no process and imports no AI client', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(1000);

    for (const forbidden of ['child_process', 'execFile', 'spawn(', '@ai-sdk/', "from 'ai'"]) {
      expect(source, `steps/index.ts must reach a model only through ctx.deps.ai`).not.toContain(
        forbidden,
      );
    }
  });

  it('the handler is registered, so the scan is not guarding an empty set', () => {
    expect(typeof STEP_HANDLERS['action.ai_agent']).toBe('function');
  });
});
