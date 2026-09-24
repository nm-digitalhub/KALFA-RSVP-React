'use client';

// `action.ai_agent` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import { AI_AGENT_MAX_TURNS, type AiAgentModel } from './definition';
import type { AiAgentSchema } from './schema';

export const aiAgentDefaultPropertiesData: NodeDataProperties<AiAgentSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'סוכן AI',
  description: 'שואל מודל שפה ומעביר את התשובה לצעדים הבאים',
  systemPrompt: '',
  // Checked against `AI_AGENT_MODELS`, so dropping the default model from the
  // definition is a type error here too.
  model: 'haiku' satisfies AiAgentModel,
  maxTurns: AI_AGENT_MAX_TURNS.default,
  tools: [],
  errorPolicy: errorPolicyOptions.fail.value,
};
