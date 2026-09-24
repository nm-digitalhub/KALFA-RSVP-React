'use client';

// `action.import_guest_list` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import type { ImportGuestListSchema } from './schema';

export const importGuestListDefaultPropertiesData: NodeDataProperties<ImportGuestListSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'קליטת רשימת אורחים',
  description: 'מעלה לסקירה קובץ או אנשי קשר שהגיעו בוואטסאפ',
  errorPolicy: errorPolicyOptions.fail.value,
};
