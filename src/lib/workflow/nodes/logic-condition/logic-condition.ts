'use client';

// `logic.condition` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
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
  // `{ id, sourceHandle, label, conditions }`. Two deliberate differences:
  //
  //   * We omit `conditions` from the item shape and the branch-condition
  //     control from the uischema, and the branches are fixed.
  //
  //     ⚠️ THE REASON THIS BULLET USED TO GIVE IS NO LONGER TRUE, and leaving
  //     it stated would keep talking a future reader out of a real feature.
  //     It said the vendor's branch conditions are `{x, y, comparisonOperator}`
  //     resolved through `resolveTemplate` "which we did not vendor", so
  //     `{{trigger.x}}` would render as literal text. `resolve-template.ts` IS
  //     vendored and wired into `activity-runner.ts` — the very next bullet
  //     says so about `outputSchema` — and `logic.switch` already ships the
  //     vendor's `DecisionBranches` control (see `switchUiSchema` in
  //     `nodes/logic-switch/uischema.ts`). So the mechanism works and is in use.
  //
  //     ⚠️ AND IT NAMED THE WRONG CONTROL. `DecisionBranches` belongs to the
  //     vendor's DECISION node (docs/workflowbuilder/nodes/decision.md); their
  //     CONDITIONAL node uses `DynamicConditions` over a `conditionsArray`
  //     (nodes/conditional.md). This entry is the conditional shape.
  //
  //     WHAT ACTUALLY STOPS IT, measured: `ConditionConfig` stores one
  //     comparison as `field`/`operator`/`value`, so "A AND B" cannot be
  //     expressed and every saved diagram carries the flat triple. The blocker
  //     is a migration of stored data, not a missing control — and the
  //     array evaluator with AND/OR already exists, serving `logic.switch`.
  //   * `outputSchema` USED to be withheld here, on the reasoning that "the
  //     picker would suggest references nothing can resolve". That held only
  //     while `resolve-template.ts` was unvendored; it is vendored and wired
  //     into `activity-runner.ts`, and the node has declared its output ever
  //     since. This bullet remained as a description of a state that no longer
  //     existed — see the declaration below.
  //
  // The starter (examples/workflow-builder-starter) has a node also called
  // "condition", and it is NOT this pattern — it is a single-output node with
  // a free-text `condition` string and no runner behind it. Modelling a
  // branching node on it is what produced the dead-branch defect this entry
  // now fixes.
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
