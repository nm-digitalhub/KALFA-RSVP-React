'use client';

// `action.sumit_create_document` — what a node dropped from the palette starts
// with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
//
// Every field seeded, none omitted. The SDK's bundled validator
// (@cfworker/json-schema) treats an ABSENT required key as invalid but an
// EMPTY one as valid — so seeding is what makes the panel's error markers
// appear on the field instead of the owner discovering the blank at arming.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import { sumitDocumentTypeOptions, type SumitCreateDocumentSchema } from './schema';

export const sumitCreateDocumentDefaultPropertiesData: NodeDataProperties<SumitCreateDocumentSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'הפקת מסמך ב-SUMIT',
  description: 'מפיק קבלה, הצעת מחיר או מסמך אחר. לא מבצע חיוב.',
  // קבלה — the document this business (עוסק פטור) actually issues.
  documentType: sumitDocumentTypeOptions.Receipt.value,
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  customerExternalId: '',
  customerNoVat: false,
  itemName: '',
  itemQuantity: 1,
  itemUnitPrice: 0,
  documentDescription: '',
  // DRAFT by default. A final document is a bookkeeping record that cannot
  // simply be deleted, so the first run of a new automation produces
  // something reviewable rather than something filed.
  isDraft: true,
  sendByEmail: false,
  errorPolicy: errorPolicyOptions.continue.value,
};
