// The "תפיסות מסגרת" (frame holds) folder in KALFA's SUMIT account, and what its
// `Billing_Status` and `Billing_Currency` codes mean. PURE — no fetch, no `server-only` — so both the
// CRM reader (`crm-holds.ts`, worker/server) and the workflow step that labels a
// SUMIT webhook (`steps/index.ts`) read ONE definition.
//
// ⚠️ SUMIT SENDS THE CODE, NEVER ITS NAME. `Billing_Status` is an enum property:
// the webhook and `listentities` both carry `[3]`, and `/crm/schema/getfolder/`
// returns the property with no option labels (measured 2026-09-23). So the names
// below are ours, and each one is only as good as the evidence recorded with it.

/** Folder 1076735289 — verified live 2026-08-30 (`scripts/sumit-crm-list-holds.ts`). */
export const SUMIT_HOLDS_FOLDER_ID = 1076735289;

/** Verified 2026-08-30: open holds listed as 1. */
export const SUMIT_HOLD_STATUS_OPEN = 1;
/**
 * Verified 2026-08-30: a hold released manually in the dashboard came back as 3,
 * its `Billing_Date` matching the campaign's `authorized_at` to the second.
 */
export const SUMIT_HOLD_STATUS_RELEASED = 3;

// ⚠️ 2 IS WEAKER EVIDENCE, and deliberately not a named export (see
// `crm-holds.ts`): "charged" comes from the reconciler's design notes, not from
// a hold observed in that state. It is labelled because a person reading an
// alert is better served by the likely meaning than by a bare digit — and the
// code is always shown next to it, so the claim can be checked.
const STATUS_LABELS: Record<number, string> = {
  [SUMIT_HOLD_STATUS_OPEN]: 'פתוחה',
  2: 'חויבה',
  [SUMIT_HOLD_STATUS_RELEASED]: 'שוחררה',
};

// ⚠️ A CRM ENUM, NOT THE CHARGE API'S. In `/billing/payments/charge/` 1 is USD
// (`CreditGuy_Typed_Currency`: ILS 0, USD 1). Here 1 is the SHEKEL — verified by
// the owner on 2026-09-23: hold 2195604142 arrived as `Billing_Currency: [1]` and
// its card in SUMIT shows ₪. Only the one code seen is named; any other stays
// "קוד לא מוכר" until a card shows what it is.
const CURRENCY_LABELS: Record<number, string> = {
  1: 'שקל',
};

function label(labels: Record<number, string>, code: unknown): string | null {
  if (typeof code !== 'number' || !Number.isFinite(code)) return null;
  return `${labels[code] ?? 'קוד לא מוכר'} (${code})`;
}

/**
 * "שוחררה (3)" for a known code, "קוד לא מוכר (7)" for an unknown one, and
 * `null` when there is no numeric code at all. The code is ALWAYS in the text,
 * so a wrong label can never hide what SUMIT actually sent.
 */
export function sumitHoldStatusLabel(code: unknown): string | null {
  return label(STATUS_LABELS, code);
}

/** "שקל (1)" — same rules as `sumitHoldStatusLabel`. */
export function sumitHoldCurrencyLabel(code: unknown): string | null {
  return label(CURRENCY_LABELS, code);
}
