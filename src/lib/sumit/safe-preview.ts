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
  };
}
