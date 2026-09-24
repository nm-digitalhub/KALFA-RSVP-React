'use client';

// `action.sumit_create_customer` — what a node dropped from the palette starts
// with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import type { SumitCreateCustomerSchema } from './schema';

export const sumitCreateCustomerDefaultPropertiesData: NodeDataProperties<SumitCreateCustomerSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'יצירת לקוח ב-SUMIT',
  description: 'יוצר כרטיס לקוח. לא מבצע חיוב.',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  city: '',
  address: '',
  companyNumber: '',
  externalId: '',
  noVat: false,
  errorPolicy: errorPolicyOptions.continue.value,
};
