// `action.sumit_create_document`: the pure contract, shared by the editor and
// the server.
//
// ⚠️ IMPORTS NOTHING, not even a type. `catalogue/types.ts` imports this file to
// build `NODE_TYPES`, `NODE_REQUIRED_FIELDS` and `KalfaNodeConfig`, so an import
// back into types.ts (even a type-only one, which `no-circular` counts) would
// close a cycle. It is also read by the pg-boss worker, so it must stay SDK-free.
// `server-code-must-not-reach-the-editor-sdk` in .dependency-cruiser.cjs enforces
// the second half.

/**
 * The node type, stored verbatim in the diagram's `data.type`.
 *
 * A persistence contract: renaming it orphans every saved workflow that used it.
 */
export const type = 'action.sumit_create_document' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * The document types this node may issue.
 *
 * NARROWER than the API's 23-value enum, and narrower on purpose twice over:
 *
 *   • Expense and supplier documents describe something WE bought. An outgoing
 *     automation has no business writing one.
 *   • `Invoice` / `InvoiceAndReceipt` are חשבונית מס, which an עוסק פטור may
 *     not issue (the business's status — see the tax notes on close-charge).
 *     They are absent so the editor cannot offer them, rather than present with
 *     a warning nobody reads.
 *
 * `Receipt` (קבלה) is the document this business actually issues.
 */
export const SUMIT_DOCUMENT_TYPES = [
  'Receipt',
  'ProformaInvoice',
  'PriceQuotation',
  'PaymentRequest',
  'Order',
  'DeliveryNote',
  'CreditReceipt',
] as const;
export type SumitDocumentTypeOption = (typeof SUMIT_DOCUMENT_TYPES)[number];

/**
 * `action.sumit_create_document` — issue an accounting document.
 *
 * Every field mirrors a name in swagger.json's `Accounting_Documents_Create_Request`
 * chain; nothing here was invented. The node NEVER carries credentials: the port
 * reads them from `app_settings`, the same reader the close-charge uses.
 *
 * ⚠️ NO MONEY MOVES. This records a document; it does not charge a card. The
 * `Payments[]` array the API also accepts is deliberately NOT exposed — on a
 * receipt it asserts that money was received, and a workflow that can assert
 * that without a charge having happened is a bookkeeping hazard, not a feature.
 */
export type SumitCreateDocumentConfig = {
  /** `Accounting_Typed_DocumentType`. See DOCUMENT_TYPES for why the list is narrowed. */
  documentType: SumitDocumentTypeOption;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  /** `Customer.ExternalIdentifier` — the anchor that ties the document back to us. */
  customerExternalId?: string;
  /** `Customer.NoVAT` — spec: "Set to true for VAT exempt customers". */
  customerNoVat?: boolean;
  itemName?: string;
  itemQuantity?: number;
  itemUnitPrice?: number;
  /**
   * `Details.Description` — printed on the document.
   *
   * NOT named `description`: every node already carries its own `description`
   * (the caption the owner reads on the canvas), and one object cannot hold
   * both. The document's text is the one that gets the qualified name, because
   * the node-level field is shared by all 21 node types.
   */
  documentDescription?: string;
  /** `Details.IsDraft` — spec: "Leave empty for final document". */
  isDraft?: boolean;
  /** `Details.SendByEmail`. */
  sendByEmail?: boolean;
};

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 *
 * documentType + a customer name are the minimum SUMIT itself requires
 * (`Details.Type`, and `Customer.Name` "Required for creating a new customer").
 */
export const requiredFields: string[] = ['label', 'description', 'documentType', 'customerName'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `customerExternalId` is our own reference for a customer, so a diagram
 * carrying one would reach for a record that does not exist anywhere else.
 * Values are `'identifier' | 'secret' | 'catalogue'` — spelled out here rather
 * than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  customerExternalId: 'identifier',
};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * returns the port's answer whole, which carries the same four keys.
 */
export const outputFields = {
  // The four fields SUMIT's own response carries
  // (`Accounting_Documents_Create_Response`). A later node can reference
  // any of them as {{nodes.<id>.<field>}} with no extra wiring.
  documentId: { type: 'number', label: 'מזהה המסמך' },
  documentNumber: { type: 'number', label: 'מספר המסמך' },
  customerId: { type: 'number', label: 'מזהה הלקוח' },
  documentDownloadUrl: { type: 'string', label: 'קישור להורדת המסמך' },
} as const;
