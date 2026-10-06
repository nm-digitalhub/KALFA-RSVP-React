'use client';

// `action.sumit_create_document` — the JSON schema of its properties panel.
// Editor side.
//
// An ACCOUNTING node: it creates a record, it does not move money. Every option
// below is a value swagger.json accepts — no label here invents a capability the
// API does not have.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields, type SumitDocumentTypeOption } from './definition';

export const sumitDocumentTypeOptions = {
  Receipt: { label: 'קבלה', value: 'Receipt' },
  ProformaInvoice: { label: 'חשבונית עסקה (פרופורמה)', value: 'ProformaInvoice' },
  PriceQuotation: { label: 'הצעת מחיר', value: 'PriceQuotation' },
  PaymentRequest: { label: 'דרישת תשלום', value: 'PaymentRequest' },
  Order: { label: 'הזמנה', value: 'Order' },
  DeliveryNote: { label: 'תעודת משלוח', value: 'DeliveryNote' },
  CreditReceipt: { label: 'קבלת זיכוי', value: 'CreditReceipt' },
} as const satisfies Record<SumitDocumentTypeOption, { label: string; value: string }>;

export const sumitCreateDocumentSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    documentType: {
      ...requiredText,
      options: Object.values(sumitDocumentTypeOptions),
    },
    customerName: { ...requiredText },
    customerEmail: { type: 'string' },
    customerPhone: { type: 'string' },
    customerExternalId: { type: 'string' },
    customerNoVat: { type: 'boolean' },
    itemName: { type: 'string' },
    itemQuantity: { type: 'number' },
    itemUnitPrice: { type: 'number' },
    documentDescription: { type: 'string' },
    isDraft: { type: 'boolean' },
    sendByEmail: { type: 'boolean' },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

export type SumitCreateDocumentSchema = typeof sumitCreateDocumentSchema;
