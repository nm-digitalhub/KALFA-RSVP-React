import 'server-only';

// Safe, admin-facing PREVIEW of the SUMIT POC request/response.
//
// SECURITY MODEL: STRICT explicit projection from known paths only. There is
// deliberately NO generic key-copying walker — the output is a FLAT object whose
// every field is assigned individually from a single named input path. Because no
// key is ever copied by name from the source, an unrecognized/future provider
// field can never reach the output. Secrets and identifiers are never valued:
//   - CompanyID / ExternalIdentifier / EmailAddress → *_present booleans (never the value)
//   - CreditCard_Token → *_token_present / has_card_token boolean
//   - SingleUseToken → og_token_present boolean
//   - AuthNumber → has_auth_number boolean (never the value)
//   - API key, CitizenID, PAN, CVV, Track2, StatusDescription → never read at all
//   - UserErrorMessage / TechnicalErrorDetails → VALUED (truncated): they describe
//     what the gateway objected to in OUR request, not anything about the payer,
//     and without them a failed diagnostic reports no reason at all
// Used by /admin/sumit-test so the raw gateway body never reaches the browser DOM.

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}
function present(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}
function firstItem(items: unknown): Obj | null {
  return Array.isArray(items) ? asObj(items[0]) : null;
}
// Provider error text, valued but bounded. Non-strings become null rather than
// being coerced — a provider that starts returning an object here must be
// looked at, not stringified into the page.
const ERROR_TEXT_MAX = 400;
function errText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.slice(0, ERROR_TEXT_MAX) : null;
}

// Every Items row, projected to the three fields that describe a PRODUCT line.
// These are operator-entered product names and prices — not card, customer or
// credential data — so showing them leaks nothing while making an itemised body
// (the base / overage / credit breakdown) actually verifiable. Still an explicit
// projection, not a pass-through: an unexpected key on a row is not echoed.
function itemLines(items: unknown): Obj[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const it = asObj(raw);
    const named = asObj(it?.Item);
    return {
      name: typeof named?.Name === 'string' ? named.Name : null,
      quantity: typeof it?.Quantity === 'number' ? it.Quantity : null,
      unit_price: typeof it?.UnitPrice === 'number' ? it.UnitPrice : null,
    };
  });
}

// What SUMIT will actually charge: it bills the SUM of the rows and ignores any
// amount we think we are sending. Surfacing it removes the arithmetic from the
// operator's head at exactly the moment a real card is about to be charged.
function itemsTotal(items: unknown): number | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  let sum = 0;
  for (const raw of items) {
    const it = asObj(raw);
    const q = typeof it?.Quantity === 'number' ? it.Quantity : null;
    const u = typeof it?.UnitPrice === 'number' ? it.UnitPrice : null;
    if (q === null || u === null) return null;
    sum += q * u;
  }
  return Math.round(sum * 100) / 100;
}

// Explicit projection of the REQUEST body we sent to SUMIT. Flat, fixed key set.
// Identifiers/tokens/email appear only as presence booleans.
export function summarizeSumitRequest(input: unknown): Obj {
  const b = asObj(input);
  if (!b) return {};
  const cred = asObj(b.Credentials);
  const cust = asObj(b.Customer);
  const item = firstItem(b.Items);
  const pm = asObj(b.PaymentMethod);
  return {
    company_id_present: present(cred?.CompanyID),
    amount: item?.UnitPrice ?? null,
    // The itemised body is the thing being verified, so every row must be
    // visible — `amount` above is only Items[0] and would silently hide the
    // overage and credit rows. Names/quantities/prices are operator-entered
    // product lines, never card or customer data.
    items: itemLines(b.Items),
    items_total: itemsTotal(b.Items),
    vat_rate: b.VATRate ?? null,
    auto_capture: b.AutoCapture ?? null,
    authorize_amount: b.AuthorizeAmount ?? null,
    prevent_document_creation: b.PreventDocumentCreation ?? null,
    card_token_present: present(pm?.CreditCard_Token),
    og_token_present: present(b.SingleUseToken),
    customer_email_present: present(cust?.EmailAddress),
    external_id_present: present(cust?.ExternalIdentifier),
    payment_method_type: pm?.Type ?? null,
  };
}

// Explicit projection of the RESPONSE from SUMIT. Flat, fixed key set. AuthNumber
// and the card token appear only as booleans; StatusDescription, CitizenID, PAN,
// CVV, Track2, ExternalIdentifier, CompanyID/CustomerID and any unknown key are
// never read. A non-object body (e.g. a plain-text error page) is not echoed.
export function summarizeSumitResponse(input: unknown): Obj {
  const r = asObj(input);
  if (!r) return { non_object_response: true };
  const data = asObj(r.Data);
  const pay = data ? asObj(data.Payment) : null;
  const pm = pay ? asObj(pay.PaymentMethod) : null;
  return {
    status: r.Status ?? null,
    valid_payment: pay?.ValidPayment ?? null,
    amount: pay?.Amount ?? null,
    currency: pay?.Currency ?? null,
    document_id: data?.DocumentID ?? null,
    document_number: data?.DocumentNumber ?? null,
    payment_id: pay?.ID ?? null,
    provider_error_code: pay?.Status ?? null,
    card_last_digits: pm?.CreditCard_LastDigits ?? null,
    card_mask: pm?.CreditCard_CardMask ?? null,
    has_auth_number: present(pay?.AuthNumber),
    has_card_token: present(pm?.CreditCard_Token),
    // WHY the call failed. Without these the screen can only say "rejected",
    // which is not a diagnosis — the first live itemised charge came back
    // Status 1 with every other field null and no way to tell what SUMIT
    // objected to.
    //
    // Safe to value, unlike the identifiers above: SUMIT documents
    // UserErrorMessage as "Error message, in a user readable format" — text
    // about the REQUEST, produced to be shown. TechnicalErrorDetails is its
    // diagnostic twin ("let us know if you received this"). Neither is customer
    // or card data. Still an explicit single-path projection, and truncated so
    // an unexpectedly long provider string cannot dominate the page.
    user_error_message: errText(r.UserErrorMessage),
    technical_error_details: errText(r.TechnicalErrorDetails),
  };
}
