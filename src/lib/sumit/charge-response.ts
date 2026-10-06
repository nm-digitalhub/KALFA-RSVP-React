// SUMIT /billing/payments/charge/ RESPONSE → one value per field, for storage
// (sumit_test_transactions). Pure, no I/O.
//
// Field NAMES come from SUMIT's own swagger (types.generated.ts) — the
// `satisfies` lists below make a renamed or misspelled field a compile error.
// Field VALUES are read defensively: the swagger types the enums (Status,
// Currency, PaymentMethod.Type) as strings like "Success (0)" while the live API
// returns numbers, so enums are kept as the raw value SUMIT sent.
//
// Card-industry rule: CreditCard_Number (full PAN), CreditCard_CVV and
// CreditCard_Track2 are never kept — not in a column, and stripped from the
// stored body.

import type { Json, TablesInsert } from '@/lib/supabase/types';
import type { components } from '@/lib/sumit/types.generated';

type Schemas = components['schemas'];
type ChargeResponse =
  Schemas['Response_OfficeGuy.Apps.Billing.MVC.API.PaymentsController_Payments_Charge_Response'];
type ChargeData = Schemas['OfficeGuy.Apps.Billing.MVC.API.PaymentsController_Payments_Charge_Response'];
type Payment = Schemas['OfficeGuy.Apps.Billing.MVC.API.Typed.Payment'];
type PaymentMethod = Schemas['OfficeGuy.Apps.Billing.MVC.API.Typed.PaymentMethod'];

// Compile-time proof that every key read below exists in SUMIT's schema.
const RESPONSE_KEYS = ['Status', 'UserErrorMessage', 'TechnicalErrorDetails', 'Data'] as const satisfies readonly (keyof ChargeResponse)[];
const DATA_KEYS = ['CustomerID', 'DocumentID', 'DocumentNumber', 'DocumentDownloadURL', 'Payment'] as const satisfies readonly (keyof ChargeData)[];
const PAYMENT_KEYS = [
  'ID', 'CustomerID', 'Date', 'ValidPayment', 'Status', 'StatusDescription', 'Amount', 'Currency',
  'PaymentMethod', 'AuthNumber', 'FirstPaymentAmount', 'NonFirstPaymentAmount', 'RecurringCustomerItemIDs',
] as const satisfies readonly (keyof Payment)[];
const PAYMENT_METHOD_KEYS = [
  'ID', 'CustomerID', 'CreditCard_LastDigits', 'CreditCard_ExpirationMonth', 'CreditCard_ExpirationYear',
  'CreditCard_CitizenID', 'CreditCard_CardMask', 'CreditCard_Token', 'DirectDebit_Bank', 'DirectDebit_Branch',
  'DirectDebit_Account', 'DirectDebit_ExpirationDate', 'DirectDebit_MaximumAmount', 'Type',
] as const satisfies readonly (keyof PaymentMethod)[];
// Returned or not, these are never kept.
const FORBIDDEN_CARD_KEYS = ['CreditCard_Number', 'CreditCard_CVV', 'CreditCard_Track2'] as const satisfies readonly (keyof PaymentMethod)[];
void RESPONSE_KEYS; void DATA_KEYS; void PAYMENT_KEYS; void PAYMENT_METHOD_KEYS;

export type Obj = Record<string, unknown>;
export function asObj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}
const obj = asObj;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
// Enums: whatever SUMIT sent (0 / "0" / "Success (0)"), as text.
const enumText = (v: unknown): string | null =>
  typeof v === 'number' || (typeof v === 'string' && v !== '') ? String(v) : null;

// Deep copy of the body with PAN / CVV / Track2 removed wherever they appear.
function stripForbidden(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripForbidden);
  const o = obj(v);
  if (!o) return v;
  const out: Obj = {};
  for (const [k, val] of Object.entries(o)) {
    if ((FORBIDDEN_CARD_KEYS as readonly string[]).includes(k)) continue;
    out[k] = stripForbidden(val);
  }
  return out;
}

export type SumitResponseColumns = Omit<
  TablesInsert<'sumit_test_transactions'>,
  | 'id' | 'created_at' | 'created_by' | 'operation' | 'parent_id' | 'request'
  | 'request_amount' | 'request_authorize_amount' | 'request_auto_capture'
  | 'request_credit_card_auth_number' | 'request_customer_id' | 'request_external_identifier'
  | 'http_status'
>;

// Pure: SUMIT response body → one value per column. Exported for tests.
export function mapSumitChargeResponse(raw: unknown): SumitResponseColumns {
  const r = obj(raw);
  if (!r) {
    return { response: null, response_text: typeof raw === 'string' ? raw.slice(0, 20000) : null };
  }
  const d = obj(r.Data);
  const p = obj(d?.Payment);
  const pm = obj(p?.PaymentMethod);
  const recurring = p?.RecurringCustomerItemIDs;
  return {
    status: enumText(r.Status),
    user_error_message: str(r.UserErrorMessage),
    technical_error_details: str(r.TechnicalErrorDetails),

    data_customer_id: int(d?.CustomerID),
    data_document_id: int(d?.DocumentID),
    data_document_number: int(d?.DocumentNumber),
    data_document_download_url: str(d?.DocumentDownloadURL),

    payment_id: int(p?.ID),
    payment_customer_id: int(p?.CustomerID),
    payment_date: str(p?.Date),
    payment_valid_payment: bool(p?.ValidPayment),
    payment_status: enumText(p?.Status),
    payment_status_description: str(p?.StatusDescription),
    payment_amount: num(p?.Amount),
    payment_currency: enumText(p?.Currency),
    payment_auth_number: str(p?.AuthNumber),
    payment_first_payment_amount: num(p?.FirstPaymentAmount),
    payment_non_first_payment_amount: num(p?.NonFirstPaymentAmount),
    payment_recurring_customer_item_ids: Array.isArray(recurring) ? (recurring as Json) : null,

    payment_method_id: int(pm?.ID),
    payment_method_customer_id: int(pm?.CustomerID),
    payment_method_last_digits: str(pm?.CreditCard_LastDigits),
    payment_method_expiration_month: int(pm?.CreditCard_ExpirationMonth),
    payment_method_expiration_year: int(pm?.CreditCard_ExpirationYear),
    payment_method_citizen_id: str(pm?.CreditCard_CitizenID),
    payment_method_card_mask: str(pm?.CreditCard_CardMask),
    payment_method_token: str(pm?.CreditCard_Token),
    payment_method_direct_debit_bank: int(pm?.DirectDebit_Bank),
    payment_method_direct_debit_branch: int(pm?.DirectDebit_Branch),
    payment_method_direct_debit_account: int(pm?.DirectDebit_Account),
    payment_method_direct_debit_expiration_date: str(pm?.DirectDebit_ExpirationDate),
    payment_method_direct_debit_maximum_amount: int(pm?.DirectDebit_MaximumAmount),
    payment_method_type: enumText(pm?.Type),

    response: stripForbidden(r) as Json,
    response_text: null,
  };
}
