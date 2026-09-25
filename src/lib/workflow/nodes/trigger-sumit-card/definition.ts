// `trigger.sumit_card`: the pure contract, shared by the editor and the server.
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
export const type = 'trigger.sumit_card' as const;

/**
 * A trigger: SUMIT calling in may begin a flow. The catalogue reads this flag,
 * and it — not the stored JSON — is what decides who may start.
 */
export const isTrigger = true;

/**
 * `trigger.sumit_card` — SUMIT tells us a card changed.
 *
 * A `trigger.webhook` whose caller is known, so its shape can be too. SUMIT's
 * trigger module POSTs `{ Folder, EntityID, Type, Properties }` to a URL it is
 * given and to nothing else (help article 10442304; the payload is visible in
 * its own "פעולות אוטומציה" log). It cannot send a header, so this node is
 * ALWAYS in `address` mode — the node TYPE decides that, never a stored field.
 *
 * FOLDER, VIEW AND CHANGE TYPE — OPTIONAL, AND THEY DO NOT FILTER HERE. They
 * are what WE register in SUMIT (`/triggers/triggers/subscribe/`) on the owner's
 * behalf, so SUMIT sends only what they select. Left blank, the owner creates the
 * trigger in SUMIT's own "יצירת טריגר" screen instead, exactly as before these
 * fields existed. On an unsigned payload they add no security either way: a
 * caller holding the address can put any `Folder` in the body.
 */
export type SumitCardTriggerConfig = {
  /** sha256 of the path segment. The address is shown once and never stored. */
  tokenHash: string;
  /** SUMIT CRM folder id to register the trigger on; '' = registered by hand in SUMIT. */
  folderId?: string;
  /** SUMIT view id inside that folder — its filters choose the cards, its columns the fields. */
  viewId?: string;
  /** SUMIT's TriggerType. Spelled as SUMIT spells it; see `SUMIT_CHANGE_TYPES`. */
  changeType?: string;
};

/**
 * SUMIT's own change types (swagger `TriggerType`), with the Hebrew the panel
 * shows. SUMIT's list, not ours — mirrored in `src/lib/sumit/crm-triggers.ts`.
 */
export const SUMIT_CHANGE_TYPES = [
  { value: 'CreateOrUpdate', label: 'יצירה או עדכון' },
  { value: 'Create', label: 'יצירה' },
  { value: 'Update', label: 'עדכון' },
  { value: 'Archive', label: 'העברה לארכיון' },
  { value: 'Delete', label: 'מחיקה' },
] as const;

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description', 'tokenHash'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * The same reasoning as `trigger.webhook`'s: a hash that authenticates to THIS
 * installation only. Values are `'identifier' | 'secret' | 'catalogue'` —
 * spelled out here rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  tokenHash: 'identifier',
  // SUMIT account ids: meaningless on another installation's SUMIT account.
  folderId: 'identifier',
  viewId: 'identifier',
};

// ---------------------------------------------------------------------------
// The output fields — PURE DATA
// ---------------------------------------------------------------------------
//
// ⚠️ WHY THEY LIVE IN AN SDK-FREE FILE. `catalogue/schemas.ts` is `'use client'`,
// so on the Next SERVER every export of it is a client reference: a function
// that throws when called and has no enumerable keys. Measured on the live build
// (2026-09-24): the editor page's server-side `getSumitCardSampleOutput` spread
// these two constants from `schemas.ts` and got `{}` and `undefined` — the picker
// lost the base fields and every measured label, with no error anywhere. tsc and
// vitest cannot see it; `npm run worker:deps` (rule
// `server-code-must-not-reach-the-editor-schemas`) does, and was red.
//
// So they are declared here, in a file that imports NOTHING. The editor (this
// folder's palette entry, and `schemas.ts`, which re-exports them) and the
// server (`catalogue/sumit-sample-output.ts`, `data/admin/workflows.ts`) all
// read them from here.

/** One entry of the SUMIT trigger's output — the SDK's `OutputProperty` shape. */
export type SumitCardOutputField = {
  type: 'string' | 'number' | 'boolean' | 'datetime' | 'date' | 'object' | 'array';
  label: string;
  description?: string;
};
export type SumitCardOutput = Record<string, SumitCardOutputField>;

/** What `sumitCardTrigger` returns for any folder. */
export const SUMIT_CARD_BASE_OUTPUT = {
  folder: { type: 'number', label: 'מזהה התיקייה', description: 'התיקייה ב-SUMIT שבה הכרטיס השתנה' },
  entityId: { type: 'number', label: 'מזהה הכרטיס' },
  changeType: {
    type: 'string',
    label: 'סוג השינוי',
    description: 'כפי ש-SUMIT שולחת, למשל CreateOrUpdate',
  },
  properties: {
    type: 'object',
    label: 'שדות הכרטיס',
    description:
      'עמודות התצוגה. כל שדה הוא רשימה — {{nodes.<מזהה>.properties.שם_השדה.0}} לערך הראשון, ו-.0.Name לשם של ערך מקושר',
  },
  body: { type: 'object', label: 'כל מה שנשלח' },
} as const;

// ⚠️ `?` IS ADVISED ONLY WHERE THE FIELD CAN BE ABSENT, and that is a trade-off
// measured in the SDK, not a style. The editor finds a reference's TYPE by
// looking its path up VERBATIM in `outputSchema.properties` (`eL` in the bundle):
// `properties.Billing_Amount.0?` matches no key, so the condition editor treats
// it as text and withdraws "greater than". So `?` goes only where a missing value
// is real — `Billing_OrderDocument` came on one release and not another, and
// `Billing_PaymentDocument` has not appeared at all. The other seven arrived on
// all three live releases of 2026-09-23 (a small sample, said as such).
const PRESENT_NOTE = 'הגיע בכל הקריאות עד כה — בלי ? כדי שבתנאי יוצעו השוואות לפי הסוג';
const OPTIONAL_NOTE = 'לא תמיד נשלח (ריק בכרטיס) — הוסיפו ? בסוף הביטוי כדי שהצעד לא ייכשל';
// The enums' option labels are NOT in the schema SUMIT returns, so the codes are
// published as codes. ⚠️ `Billing_Currency` is a CRM enum: do not read it with the
// charge API's currency codes (where 1 is USD) — the measured hold was in shekels.
const ENUM_NOTE = 'קוד מספרי כפי ש-SUMIT שולחת; SUMIT לא מחזירה את שמות האפשרויות';
const HOLDS = '(תפיסות מסגרת)';

/** The "תפיסות מסגרת" folder's nine properties, as measured — see `outputFields`. */
export const SUMIT_HOLD_FIELDS_OUTPUT = {
  'properties.Billing_Date.0': { type: 'datetime', label: `תאריך ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_Amount.0': { type: 'number', label: `סכום ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_Currency.0': { type: 'number', label: `מטבע — קוד ${HOLDS}`, description: `${ENUM_NOTE}. ${PRESENT_NOTE}` },
  'properties.Billing_Status.0': { type: 'number', label: `סטטוס — קוד ${HOLDS}`, description: `${ENUM_NOTE}. ${PRESENT_NOTE}` },
  // A string, not a path into `properties`: the handler adds it (see
  // `sumitHoldStatusLabel`). Compare the CODE above in a condition; show this.
  holdStatus: {
    type: 'string',
    label: `סטטוס — בעברית ${HOLDS}`,
    description: 'למשל "שוחררה (3)". הקוד תמיד מופיע בסוגריים; ריק כשהכרטיס לא מתיקיית תפיסות מסגרת',
  },
  holdCurrency: {
    type: 'string',
    label: `מטבע — בעברית ${HOLDS}`,
    description: 'למשל "שקל (1)". הקוד תמיד מופיע בסוגריים; ריק כשהכרטיס לא מתיקיית תפיסות מסגרת',
  },
  'properties.Billing_Customer.0.Name': { type: 'string', label: `לקוח/ה — שם ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_Customer.0.ID': { type: 'number', label: `לקוח/ה — מזהה ב-SUMIT ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_PaymentMethod.0.Name': { type: 'string', label: `אמצעי תשלום — שם ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_PaymentMethod.0.ID': { type: 'number', label: `אמצעי תשלום — מזהה ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_CreditGuyTransaction.0.Name': { type: 'string', label: `פעולה במסוף — שם ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_CreditGuyTransaction.0.ID': { type: 'number', label: `פעולה במסוף — מזהה ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_OrderDocument.0.Name': { type: 'string', label: `מסמך הזמנה — שם ${HOLDS}`, description: OPTIONAL_NOTE },
  'properties.Billing_OrderDocument.0.ID': { type: 'number', label: `מסמך הזמנה — מזהה ${HOLDS}`, description: OPTIONAL_NOTE },
  'properties.Billing_PaymentDocument.0.Name': { type: 'string', label: `מסמך חיוב — שם ${HOLDS}`, description: OPTIONAL_NOTE },
  'properties.Billing_PaymentDocument.0.ID': { type: 'number', label: `מסמך חיוב — מזהה ${HOLDS}`, description: OPTIONAL_NOTE },
} as const;

/**
 * What the handler returns, as the variable picker offers it: the base fields,
 * then the "תפיסות מסגרת" ones.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same keys by hand; `references.test.ts` is what catches a
 * template naming a key this list does not declare. For a workflow SUMIT has
 * already called, `buildPaletteItems` replaces it with the fields that call
 * carried — see `sumitCardOutputFromSample`.
 *
 * The "תפיסות מסגרת" fields were MEASURED, not guessed: `/crm/schema/getfolder/`
 * on folder 1076735289 (2026-09-23) returned exactly these nine `APIName`s,
 * and the live webhooks carried the same keys with these shapes (every value
 * a list; references as `{ ID, Name, … }`). Keys are paths: the picker inserts
 * `{{nodes.<id>.<key>}}` verbatim and `resolveTemplate` walks dots through
 * arrays, so `.0` is the first value. (The vendor's docs call array indexing
 * unsupported; the vendored resolver does it anyway, unmodified, and
 * `sumit-card-trigger.test.ts` pins that it still does.)
 *
 * ⚠️ FLAT, ALTHOUGH THE FIELDS BELONG TO ONE FOLDER — chosen over the SDK's
 * `variant` form after measuring both. `variant` (fields chosen by a node
 * setting) is typed in `index.d.ts` but absent from the docs, and the editor
 * resolves a reference's TYPE only from `outputSchema.properties` (`eL`) —
 * so under `variant` every field reads as text and the condition editor
 * never offers "greater than" on the amount. None of the four decorable SDK
 * functions touches type lookup, so no plugin can fix it. The price of flat
 * is that another folder's SUMIT node is offered these too; each label says
 * "(תפיסות מסגרת)".
 */
export const outputFields = { ...SUMIT_CARD_BASE_OUTPUT, ...SUMIT_HOLD_FIELDS_OUTPUT } as const;
