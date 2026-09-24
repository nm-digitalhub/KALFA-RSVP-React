'use client';

// `logic.switch` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import { SWITCH_DEFAULT_BRANCH_ID, SWITCH_DEFAULT_HANDLE } from './definition';
import type { SwitchSchema } from './schema';

export const switchDefaultPropertiesData: NodeDataProperties<SwitchSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'ניתוב לפי תנאים',
  description: 'מפצל את התהליך לכמה מסלולים — מסלול לכל תנאי, ועוד ברירת מחדל',
  left: '',
  // SEEDED, and both entries matter.
  //
  // The DEFAULT must exist from the first drop: the handler falls through to
  // it by elimination, and a node dropped with `[]` would have no port to
  // fall through to and would dead-end the run on its very first unmatched
  // value. It is last so it reads as the fall-through it is.
  //
  // One empty branch above it is the affordance: an owner who drops the node
  // sees a card to fill in rather than an empty panel and a lone "אחרת". Its
  // `conditions: []` never matches until the owner writes a row, which is the
  // same rule the SDK's own "add branch" produces.
  //
  // `source:inner:<id>` is `getHandleId({ handleType: 'source', innerId })` —
  // spelled as a constant here because this node's worker-side twin
  // (`definition.ts`) must not import the SDK. Branches the OWNER adds get theirs
  // minted by the control, in this same shape.
  decisionBranches: [
    { id: 'branch-1', sourceHandle: 'source:inner:branch-1', label: 'מסלול ראשון', conditions: [] },
    {
      id: SWITCH_DEFAULT_BRANCH_ID,
      sourceHandle: SWITCH_DEFAULT_HANDLE,
      label: 'אחרת',
      conditions: [],
    },
  ],
};
