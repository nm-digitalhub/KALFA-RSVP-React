'use client';

// `action.send_whatsapp` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import type { SendWhatsappSchema } from './schema';

export const sendWhatsappDefaultPropertiesData: NodeDataProperties<SendWhatsappSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'שליחת הודעת וואטסאפ',
  description: 'משיב לאורח ששלח את ההודעה',
  body: '',
  errorPolicy: errorPolicyOptions.fail.value,
};
