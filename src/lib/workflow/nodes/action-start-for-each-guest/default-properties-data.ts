'use client';

// `action.start_for_each_guest` — what a node dropped from the palette starts
// with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import type { ForEachGuestSchema } from './schema';

export const forEachGuestDefaultPropertiesData: NodeDataProperties<ForEachGuestSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'הרצה לכל אורח',
  description: 'מתחיל תהליך נפרד לכל אורח שמתאים',
  targetWorkflowId: '',
  statuses: [],
  requirePhone: true,
  // A deliberately SMALL default. A number an owner has to raise on purpose
  // is a number they have thought about.
  maxGuests: 25,
  errorPolicy: errorPolicyOptions.fail.value,
};
