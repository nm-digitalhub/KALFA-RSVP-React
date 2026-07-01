import 'server-only';

// Safe, admin-facing PREVIEW of the SUMIT POC request/response.
//
// SECURITY MODEL: allow-list PROJECTION, never clone-and-delete. We build a fresh
// object containing ONLY explicitly-approved fields; anything not named here is
// silently omitted. This is fail-closed by construction — a new field the payment
// provider adds in the future (or an unexpected shape) can never leak, because it
// is never read. Secret/PII values are reduced to booleans or dropped entirely:
//   - CreditCard_Token       → had-token boolean (never the value)         [secret]
//   - CreditCard_CitizenID   → has-citizen-id boolean (never the value)    [PII]
//   - AuthNumber             → has_auth_number boolean (never the value)   [minimize]
//   - CreditCard_Number/CVV/Track2 → OMITTED (not projected at all)        [PAN/SAD]
//   - Credentials.APIKey / SingleUseToken → never projected as a value
// Used by the /admin/sumit-test route so the raw gateway body never reaches the
// browser DOM.

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}

function present(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

// Copy only the named keys that actually exist on `src` into a new object.
function pick(src: Obj, keys: readonly string[]): Obj {
  const out: Obj = {};
  for (const k of keys) {
    if (k in src) out[k] = src[k];
  }
  return out;
}

const REQUEST_PARAM_KEYS = [
  'VATIncluded',
  'VATRate',
  'AutoCapture',
  'AuthorizeAmount',
  'CardTokenNotNeeded',
  'PreventDocumentCreation',
  'SendDocumentByEmail',
  'DraftDocument',
] as const;

// Project the REQUEST body we sent to SUMIT (already API-key-masked upstream) to
// only the fields that are safe to show the admin. Tokens/email → booleans.
export function summarizeSumitRequest(input: unknown): Obj {
  const b = asObj(input);
  if (!b) return {};

  const out: Obj = pick(b, REQUEST_PARAM_KEYS);

  const cred = asObj(b.Credentials);
  if (cred) out.Credentials = pick(cred, ['CompanyID']); // APIKey intentionally never projected

  const cust = asObj(b.Customer);
  if (cust) {
    out.Customer = {
      ...pick(cust, ['ExternalIdentifier']),
      has_email: present(cust.EmailAddress),
    };
  }

  if (Array.isArray(b.Items)) {
    out.Items = b.Items.map((it) => {
      const io = asObj(it);
      if (!io) return {};
      const item: Obj = pick(io, ['Quantity', 'UnitPrice', 'Description']);
      const inner = asObj(io.Item);
      if (inner && present(inner.Name)) item.Item = { Name: inner.Name };
      return item;
    });
  }

  // Tokens → boolean presence only, never the value.
  out.has_single_use_token = present(b.SingleUseToken);
  const pm = asObj(b.PaymentMethod);
  if (pm) {
    out.PaymentMethod = {
      ...pick(pm, ['Type']),
      has_card_token: present(pm.CreditCard_Token),
    };
  }

  return out;
}

const RESPONSE_PAYMENT_METHOD_SAFE = [
  'ID',
  'Type',
  'CreditCard_LastDigits',
  'CreditCard_CardMask',
  'CreditCard_ExpirationMonth',
  'CreditCard_ExpirationYear',
] as const;

const RESPONSE_PAYMENT_SAFE = [
  'ID',
  'CustomerID',
  'Date',
  'ValidPayment',
  'Status',
  'StatusDescription',
  'Amount',
  'Currency',
] as const;

const RESPONSE_DATA_SAFE = [
  'DocumentID',
  'DocumentNumber',
  'CustomerID',
  'DocumentDownloadURL',
] as const;

// Project the RESPONSE from SUMIT to only approved fields. Secret/PII → booleans
// or omitted. A non-object body (e.g. a plain-text error page) is NOT echoed.
export function summarizeSumitResponse(input: unknown): Obj {
  const r = asObj(input);
  if (!r) return { non_object_response: true };

  const out: Obj = pick(r, ['Status', 'UserErrorMessage', 'TechnicalErrorDetails']);

  const data = asObj(r.Data);
  if (data) {
    const d: Obj = pick(data, RESPONSE_DATA_SAFE);
    const pay = asObj(data.Payment);
    if (pay) {
      const p: Obj = pick(pay, RESPONSE_PAYMENT_SAFE);
      p.has_auth_number = present(pay.AuthNumber);
      const pm = asObj(pay.PaymentMethod);
      if (pm) {
        p.PaymentMethod = {
          ...pick(pm, RESPONSE_PAYMENT_METHOD_SAFE),
          has_card_token: present(pm.CreditCard_Token),
          has_citizen_id: present(pm.CreditCard_CitizenID),
          // CreditCard_Number / CreditCard_CVV / CreditCard_Track2 deliberately
          // NOT projected — never shown, even when the gateway returns them.
        };
      }
      d.Payment = p;
    }
    out.Data = d;
  } else if ('Data' in r) {
    // Business/technical error → Data is explicitly null; preserve that signal.
    out.Data = null;
  }

  return out;
}
