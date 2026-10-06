// The answers the package purchase route can send back to the payment page (`?error=<code>`), and the sentence the
// customer reads for each. One module on purpose: the route picks a code, the page shows the sentence, and
// package-purchase-errors.test.ts proves every code has one — a route code without a sentence would render as an
// error banner with nothing in it.
//
// Customer-facing wording that touches what is charged is reviewed for compliance before it goes live; it lives here,
// as data, so that review changes one file. None of it names the payment provider.

export const PURCHASE_ERROR = {
  TOKEN_MISSING: 'token_missing',
  DISABLED: 'purchase_disabled',
  BAD_STATE: 'bad_state',
  IN_PROGRESS: 'purchase_in_progress',
  REVIEW: 'purchase_review',
  DECLINED: 'purchase_declined',
  FAILED: 'purchase_failed',
  CREDIT: 'credit_unsupported',
  EVENT_PAST: 'event_past',
  EVENT_NOT_ACTIVE: 'event_not_active',
} as const;

export type PurchaseErrorCode = (typeof PURCHASE_ERROR)[keyof typeof PURCHASE_ERROR];

export const PURCHASE_ERROR_MESSAGES: Record<PurchaseErrorCode, string> = {
  token_missing: 'לא התקבלו פרטי אשראי. נסו שוב.',
  purchase_disabled: 'שלב התשלום אינו פעיל כעת.',
  bad_state: 'לא ניתן לרכוש חבילה במצב הנוכחי של הקמפיין.',
  purchase_in_progress: 'תשלום כבר מתבצע עבור הקמפיין הזה. המתינו מספר שניות ורעננו את העמוד — אין לשלם שוב.',
  purchase_review: 'לא התקבל אישור חד-משמעי על התשלום. אין לשלם שוב — נבדוק את הנושא ונחזור אליכם.',
  purchase_declined: 'התשלום נדחה על ידי חברת האשראי. בדקו את פרטי הכרטיס ונסו שוב.',
  purchase_failed: 'הרכישה לא הושלמה בגלל תקלה. נסו שוב בעוד רגע, ואם הבעיה נמשכת פנו לתמיכה.',
  credit_unsupported: 'לאירוע הזה יש קרדיט פתוח, ורכישה עם קרדיט עדיין לא נתמכת. פנו לתמיכה להשלמת הרכישה.',
  event_past: 'מועד האירוע כבר חלף — לא ניתן לרכוש חבילה עבור אירוע שעבר.',
  event_not_active: 'פרטי האירוע עוד לא אושרו — יש לאשר אותם לפני התשלום.',
};

// `?error=` is attacker-controlled text. Only a code this module defines selects a sentence; anything else is nothing.
export function purchaseErrorMessage(code: string | undefined): string | null {
  if (code === undefined) return null;
  return Object.prototype.hasOwnProperty.call(PURCHASE_ERROR_MESSAGES, code)
    ? PURCHASE_ERROR_MESSAGES[code as PurchaseErrorCode]
    : null;
}
