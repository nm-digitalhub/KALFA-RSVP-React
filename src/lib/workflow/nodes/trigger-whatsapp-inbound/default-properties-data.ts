'use client';

// `trigger.whatsapp_inbound` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import type { WhatsappInboundSchema } from './schema';

export const whatsappInboundDefaultPropertiesData: NodeDataProperties<WhatsappInboundSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'הודעת וואטסאפ נכנסת',
  description: 'מתחיל את התהליך כשאורח שולח הודעה',
  keyword: '',
  // Empty = any number. The owner's ruling 2026-09-13: a diagram saved
  // before this field must not silently narrow to one line.
  phoneNumberId: '',
};
