'use client';

// `trigger.sumit_card` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import type { SumitCardTriggerSchema } from './schema';

export const sumitCardTriggerDefaultPropertiesData: NodeDataProperties<SumitCardTriggerSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'שינוי בכרטיס SUMIT',
  description: 'SUMIT מודיעה שכרטיס נוצר, עודכן, הועבר לארכיון או נמחק',
  // EMPTY: minted in the editor, shown once, stored only as a hash.
  tokenHash: '',
};
