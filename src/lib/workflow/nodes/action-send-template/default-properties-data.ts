'use client';

// `action.send_template` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import type { SendTemplateSchema } from './schema';

export const sendTemplateDefaultPropertiesData: NodeDataProperties<SendTemplateSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'שליחת תבנית',
  description: 'שולח לאורח תבנית מאושרת — אפשרי בכל זמן',
  messageKey: 'reminder_1',
};
