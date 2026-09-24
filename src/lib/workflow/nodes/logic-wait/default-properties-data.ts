'use client';

// `logic.wait` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import { waitUnitOptions, type WaitSchema } from './schema';

export const waitDefaultPropertiesData: NodeDataProperties<WaitSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'המתנה',
  description: 'עוצר את התהליך וממשיך אותו מאוחר יותר',
  amount: 1,
  unit: waitUnitOptions.days.value,
};
