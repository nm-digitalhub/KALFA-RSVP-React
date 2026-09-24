// `action.sumit_create_document` — the step handler. Server side: SDK-free, and
// it imports the shared step contract from `steps/shared`, never from
// `steps/index` (the registry imports this file, so that would be a cycle).
import { readEnum, readString, type StepHandler, type StringKeyOf } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import * as sumitCreateDocumentDefinition from './definition';
import type { SumitCreateDocumentConfig } from './definition';

/**
 * `action.sumit_create_document` — issue an accounting document.
 *
 * ⚠️ NO MONEY MOVES HERE, and the PORT is what guarantees it: `ctx.deps.accounting`
 * exposes document and customer creation only. Authorize, capture and credit are
 * not on it, so this handler could not charge a card even if it tried.
 *
 * ⚠️ AND NOTHING REACHES THE PROVIDER FROM A DRY RUN. The port is swapped for a
 * recording stub (engine/dry-run.ts), so the editor's "הרצת בדיקה" reports what
 * it WOULD issue and the books stay untouched — the owner's explicit decision,
 * 2026-09-22.
 *
 * The item is OPTIONAL: `Accounting_Typed_DocumentItem` is itself optional in the
 * spec and a receipt legitimately carries none. A HALF-filled item is refused
 * rather than sent — SUMIT answers a nameless item with "Missing Item details",
 * and a priced line with no name is never what was meant.
 */
export const sumitCreateDocument: StepHandler = async (config, ctx) => {
  const documentType = readEnum(
    config,
    'documentType',
    sumitCreateDocumentDefinition.SUMIT_DOCUMENT_TYPES,
    sumitCreateDocumentDefinition.type,
  );
  // The string keys are checked against SumitCreateDocumentConfig at compile
  // time; the values are still read defensively, because the config is an
  // unvalidated jsonb row.
  const customerName = readString<SumitCreateDocumentConfig>(config, 'customerName').trim();
  if (!customerName) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "הפקת מסמך ב-SUMIT" חסר שם לקוח.',
    );
  }

  const itemName = readString<SumitCreateDocumentConfig>(config, 'itemName').trim();
  const itemUnitPrice = Number(config.itemUnitPrice);
  const rawQuantity = Number(config.itemQuantity);
  const itemQuantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  const hasPrice = Number.isFinite(itemUnitPrice) && itemUnitPrice !== 0;

  if (Boolean(itemName) !== hasPrice) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'שורת הפריט במסמך חלקית — מלאו גם שם פריט וגם מחיר, או השאירו את שניהם ריקים.',
    );
  }

  const optional = (key: StringKeyOf<SumitCreateDocumentConfig>): string | undefined => {
    const value = readString<SumitCreateDocumentConfig>(config, key).trim();
    return value ? value : undefined;
  };

  const result = await ctx.deps.accounting.createDocument({
    type: documentType,
    customerName,
    // Omitted when blank rather than sent as '', so SUMIT never has to tell a
    // deliberately-empty field from one that resolved to nothing.
    customerEmail: optional('customerEmail'),
    customerPhone: optional('customerPhone'),
    customerExternalId: optional('customerExternalId'),
    ...(typeof config.customerNoVat === 'boolean'
      ? { customerNoVat: config.customerNoVat }
      : {}),
    ...(itemName && hasPrice
      ? { items: [{ name: itemName, quantity: itemQuantity, unitPrice: itemUnitPrice }] }
      : {}),
    description: optional('documentDescription'),
    ...(typeof config.isDraft === 'boolean' ? { isDraft: config.isDraft } : {}),
    ...(typeof config.sendByEmail === 'boolean' ? { sendByEmail: config.sendByEmail } : {}),
  });

  // Returned WHOLE, so a later node can reference any field as
  // {{nodes.<id>.documentId}} — the resolver already serves node types nobody
  // had written when it was built (activity-runner's resolveConfigTemplates).
  return { output: result };
};
