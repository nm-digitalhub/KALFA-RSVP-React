'use client';

// `action.webhook` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import { httpMethodOptions, type WebhookSchema } from './schema';

export const webhookDefaultPropertiesData: NodeDataProperties<WebhookSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'קריאת HTTP',
  description: 'קורא למערכת חיצונית — עם אימות, אם צריך',
  // POST explicitly, rather than left absent: the reader defaults an absent
  // method to POST for diagrams saved before the field existed, but a NEW
  // node should say what it does rather than rely on that.
  method: httpMethodOptions.POST.value,
  url: '',
  body: '',
  // No seeded empty row. The control adds one on demand, and a node that
  // needs no header should not persist `headers: [{name:'',value:''}]`.
  headers: [],
  captureResponse: false,
  errorPolicy: errorPolicyOptions.fail.value,
};
