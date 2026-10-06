// `action.ai_agent` — the step handler. Server side: SDK-free, and it imports
// the shared step contract from `steps/shared`, never from `steps/index` (the
// registry imports this file, so that would be a cycle).
import { readEnum, readString, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import * as aiAgentDefinition from './definition';
import { AI_AGENT_MAX_TURNS, AI_AGENT_MODELS, type AiAgentConfig } from './definition';

/**
 * Ask a model, and put its answer on the run.
 *
 * ⚠️ IT REACHES THE MODEL ONLY THROUGH `ctx.deps.ai`, which is the property the
 * dry run depends on. The editor's "הרצת בדיקה" panel promises the run changes
 * nothing; a model call changes no row but does cost money and does return prose
 * an owner could mistake for a real answer. The dry run swaps PORTS, so a future
 * edit that spawned the CLI directly here would bill a card from a test button
 * — the same trap `sumit-accounting.test.ts` source-scans for.
 *
 * ⚠️ THE ANSWER IS TEXT, AND THAT IS THE WHOLE CONTRACT. No JSON parsing, no
 * schema coercion, no "the model said yes so branch left". A step that tried to
 * interpret the answer would be deciding, silently and differently every run,
 * what counts as agreement. Branching stays where it already works: put a
 * `logic.condition` after this node and compare `{{nodes.<id>.text}}` yourself,
 * in a rule that is visible on the canvas and the same on every run.
 */
export const aiAgent: StepHandler = async (config, ctx) => {
  // The key is checked against AiAgentConfig at compile time; the value is still
  // read defensively, because the config is an unvalidated jsonb row.
  const prompt = readString<AiAgentConfig>(config, 'systemPrompt').trim();
  if (prompt === '') {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "סוכן AI" לא הוגדר עם הנחיה.',
    );
  }

  const model = readEnum(config, 'model', [...AI_AGENT_MODELS], aiAgentDefinition.type);

  const rawTurns = config.maxTurns;
  const requested = typeof rawTurns === 'number' ? rawTurns : Number(rawTurns);
  // Clamped rather than refused: a value outside the range is a slider that
  // moved, not a step nobody configured, and failing a run over it would be the
  // wrong trade. The CEILING is what matters — it is what stops a loop.
  const maxTurns = Number.isFinite(requested)
    ? Math.min(Math.max(Math.floor(requested), AI_AGENT_MAX_TURNS.min), AI_AGENT_MAX_TURNS.max)
    : AI_AGENT_MAX_TURNS.default;

  // ⚠️ NAMES ONLY, AND THE PORT DOES NOT ACT ON THEM YET. `apiKey` is part of the
  // SDK control's fixed row shape and is deliberately never read — a diagram is
  // exportable. The names are collected here so the shape is right the day a
  // tool layer exists; until then the live port drops them, and the panel says
  // so in as many words.
  const tools = Array.isArray(config.tools)
    ? config.tools
        .map((row) =>
          row && typeof row === 'object' && typeof (row as { tool?: unknown }).tool === 'string'
            ? (row as { tool: string }).tool.trim()
            : '',
        )
        .filter((name) => name !== '')
    : [];

  const answer = await ctx.deps.ai.run({ prompt, model, tools, maxTurns });

  return {
    output: {
      text: answer.text,
      // Published so a run's cost is visible on the step that spent it, the way
      // the fleet's own index line records it per role.
      costUsd: answer.costUsd,
      sessionId: answer.sessionId,
    },
  };
};
