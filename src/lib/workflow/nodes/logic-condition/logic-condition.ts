'use client';

// `logic.condition` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS`.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { conditionDefaultPropertiesData } from './default-properties-data';
import * as conditionDefinition from './definition';
import { conditionSchema } from './schema';
import { conditionUiSchema } from './uischema';

export const conditionPaletteItem = {
  type: conditionDefinition.type,
  label: 'תנאי',
  description: 'מפצל את התהליך לשני מסלולים',
  icon: 'GitBranch',
  // Renders with the SDK's built-in decision body instead of the default
  // one-in/one-out node. `jb(paletteType, templateType, customTemplates)`
  // in the SDK resolves this to the React Flow node type at drop time, so the
  // node gets the branch handles, the OptionalNodeContent slot our execution
  // badges mount into, and the NodeAsPortWrapper drag behaviour — none of
  // which a hand-written `nodeTemplates` entry would have kept.
  // `NodeType` is an enum (a VALUE), not a string union — the literal
  // 'decision-node' does not type-check even though it is the same string.
  //
  // This is the vendor's own canonical shape for a branching node, not an
  // invention: apps/demo/src/app/data/nodes/decision/ declares exactly
  // `templateType: NodeType.DecisionNode` plus a `decisionBranches` array of
  // `{ id, sourceHandle, label, conditions }`. One deliberate difference:
  //
  //   * We omit `conditions` from the item shape and the branch-condition
  //     control from the uischema, and the branches are fixed.
  //
  //     It is not the mechanism that stops it: `resolve-template.ts` is
  //     vendored and wired into `activity-runner.ts`, and `logic.switch`
  //     already ships the vendor's `DecisionBranches` control (see
  //     `switchUiSchema` in `nodes/logic-switch/uischema.ts`). Note that
  //     `DecisionBranches` belongs to the vendor's DECISION node
  //     (docs/workflowbuilder/nodes/decision.md); their CONDITIONAL node uses
  //     `DynamicConditions` over a `conditionsArray` (nodes/conditional.md).
  //     This entry is the conditional shape.
  //
  //     WHAT ACTUALLY STOPS IT, measured: `ConditionConfig` stores one
  //     comparison as `field`/`operator`/`value`, so "A AND B" cannot be
  //     expressed and every saved diagram carries the flat triple. The blocker
  //     is a migration of stored data, not a missing control — and the
  //     array evaluator with AND/OR already exists, serving `logic.switch`.
  //
  // The starter (examples/workflow-builder-starter) has a node also called
  // "condition", and it is NOT this pattern — it is a single-output node with
  // a free-text `condition` string and no runner behind it. Modelling a
  // branching node on it yields a dead branch: both outgoing edges leave the
  // same bare handle, so the runner cannot tell them apart.
  templateType: NodeType.DecisionNode,
  schema: conditionSchema,
  uischema: conditionUiSchema,
  // Declared so the variable picker can OFFER this node's output instead of
  // making an owner type a node id by hand. Declaring it also makes the shape
  // a deliberate contract: renaming `result` now breaks saved workflows, so
  // the name is chosen once and kept.
  outputSchema: {
    type: 'default',
    properties: conditionDefinition.outputFields,
  },
  defaultPropertiesData: conditionDefaultPropertiesData,
} satisfies PaletteItem<typeof conditionSchema>;
