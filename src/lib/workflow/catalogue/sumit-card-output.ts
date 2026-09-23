// The SUMIT card trigger's output fields — PURE DATA, and deliberately NOT in
// `schemas.ts`.
//
// ⚠️ WHY A FILE OF ITS OWN. `schemas.ts` is `'use client'`, so on the Next
// SERVER every export of it is a client reference: a function that throws when
// called and has no enumerable keys. Measured on the live build (2026-09-24):
// the editor page's server-side `getSumitCardSampleOutput` spread these two
// constants from `schemas.ts` and got `{}` and `undefined` — the picker lost the
// base fields and every measured label, with no error anywhere. tsc and vitest
// cannot see it; `npm run worker:deps` (rule
// `server-code-must-not-reach-the-editor-schemas`) does, and was red.
//
// So this file imports NOTHING. The editor (`schemas.ts`) and the server
// (`sumit-sample-output.ts`, `data/admin/workflows.ts`) both read it from here.

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

/** The "תפיסות מסגרת" folder's nine properties, as measured — see `outputSchema`. */
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
