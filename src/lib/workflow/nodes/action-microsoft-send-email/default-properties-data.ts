'use client';

// `action.microsoft_send_email` — what a node dropped from the palette starts
// with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import {
  microsoftContentTypeOptions,
  microsoftImportanceOptions,
  type MicrosoftSendEmailSchema,
} from './schema';

export const microsoftSendEmailDefaultPropertiesData: NodeDataProperties<MicrosoftSendEmailSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'שליחת דוא״ל ב-Microsoft 365',
  description: 'שולח הודעת דוא״ל באמצעות חיבור Microsoft 365 מנוהל',
  connectionId: '',
  to: '',
  cc: '',
  bcc: '',
  replyTo: '',
  subject: '',
  body: '',
  // Graph's own defaults, spelled out so a NEW node and an OLD one that
  // carries none of these fields send byte-identical mail.
  contentType: microsoftContentTypeOptions.Text.value,
  importance: microsoftImportanceOptions.normal.value,
  saveToSentItems: true,
  errorPolicy: errorPolicyOptions.fail.value,
};
