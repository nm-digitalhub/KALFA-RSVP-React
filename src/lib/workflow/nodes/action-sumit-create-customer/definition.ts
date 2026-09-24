// `action.sumit_create_customer`: the pure contract, shared by the editor and
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
export const type = 'action.sumit_create_customer' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/** `action.sumit_create_customer` — `Accounting_Typed_Customer`, creating side only. */
export type SumitCreateCustomerConfig = {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  city?: string;
  address?: string;
  /** `CompanyNumber` — spec: "Customer registered company number (VAT number)". */
  companyNumber?: string;
  externalId?: string;
  noVat?: boolean;
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
 * A customer name is the minimum SUMIT itself requires (`Customer.Name`
 * "Required for creating a new customer").
 */
export const requiredFields: string[] = ['label', 'description', 'customerName'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `externalId` is our own reference for a customer, so a diagram carrying one
 * would reach for a record that does not exist anywhere else. Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  externalId: 'identifier',
};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * returns the port's answer whole, which carries the same two keys.
 */
export const outputFields = {
  customerId: { type: 'number', label: 'מזהה הלקוח' },
  customerHistoryUrl: { type: 'string', label: 'קישור לכרטיס הלקוח' },
} as const;
