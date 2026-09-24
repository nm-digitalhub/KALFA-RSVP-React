'use client';

// `logic.condition` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import { CONDITION_BRANCH_HANDLES } from './definition';
import { conditionFieldOptions, conditionOperatorOptions, type ConditionSchema } from './schema';

export const conditionDefaultPropertiesData: NodeDataProperties<ConditionSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'תנאי',
  description: 'מפצל את התהליך לשני מסלולים',
  field: conditionFieldOptions.message_text.value,
  operator: conditionOperatorOptions.contains.value,
  value: '',
  // Seeded, and never generated. The SDK's own "add branch" mints
  // `crypto.randomUUID()` for both fields; ours are fixed so the worker can
  // name the port it wants without reading the diagram. `id` is only React's
  // list key. The labels are what the owner reads beside each handle.
  decisionBranches: [
    { id: 'true', sourceHandle: CONDITION_BRANCH_HANDLES.true, label: 'מתקיים' },
    { id: 'false', sourceHandle: CONDITION_BRANCH_HANDLES.false, label: 'לא מתקיים' },
  ],
};
