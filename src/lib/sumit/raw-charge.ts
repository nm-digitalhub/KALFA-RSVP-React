import 'server-only';

// POC/diagnostic charge against the SUMIT REST API. Unlike the production
// chargeSumit (which returns only DocumentID and maps outcomes), this returns
// the FULL raw response so we can verify, against live behavior, what SUMIT
// actually returns for J5 (AutoCapture:false) — Payment.AuthNumber, a saved
// card token, capture requirements, validity window — before building the
// production route-B / J5 flow. Admin-only. Never log the raw response: it can
// contain AuthNumber / last-4 / saved token.

const SUMIT_CHARGE_URL = 'https://api.sumit.co.il/billing/payments/charge/';

export interface SumitRawChargeParams {
  companyId: number;
  apiKey: string;
  ogToken?: string; // single-use token (new card). Mutually exclusive with savedCardToken.
  savedCardToken?: string; // reusable CreditCard_Token (route B / J4 on saved card)
  // Required alongside savedCardToken (verified live 2026-07-01; swagger.json's
  // own field descriptions confirm expiry + CitizenID accompany a CreditCard
  // PaymentMethod — CitizenID is conditional per-issuer in the spec, and IS
  // required for Israeli-issued cards). Mirrors capture.ts's PaymentMethod exactly.
  savedCardExpMonth?: number;
  savedCardExpYear?: number;
  savedCardCitizenId?: string;
  // CreditCard_CVV — "Required when CVV is required by credit company"
  // (swagger.json field description), i.e. conditional per issuer, not global.
  // Production capture.ts sends a token charge WITHOUT it and is verified live,
  // so it stays optional here; the POC carries it for the issuers that do ask,
  // and for reproducing a decline that turns out to be a missing CVV.
  // NEVER logged and never echoed — safe-preview.ts projects an allow-list and
  // does not read this key at all.
  savedCardCvv?: string;
  amount: string; // Items[0].UnitPrice — numeric string, no float distortion
  vatRate: string;
  autoCapture: boolean; // false = J5 (authorize/hold), true = J4 (charge)
  authorizeAmount?: string; // J5 hold amount (defaults to Items total if absent)
  cardTokenNotNeeded?: boolean; // omit = SUMIT default (saves the card token)
  preventDocumentCreation?: boolean; // J5 hold: skip the Order doc (no payment to balance)
  customerEmail?: string;
  externalId: string; // Customer.ExternalIdentifier (reconciliation anchor)
  // Accounting_Typed_Customer.ID ("SUMIT identifier... leave empty to create a
  // new entity"). Set this to charge under an EXISTING SUMIT customer record
  // instead of creating a new one — omitting it (the previous, only, behavior)
  // silently creates a fresh customer even when reusing the same card token.
  customerId?: number;
  /**
   * OPTIONAL itemised Items rows, replacing the single POC line. This is how
   * the production receipt breakdown ("דמי הפעלה" / "אנשי קשר נוספים" / a
   * negative "קרדיט" row) gets exercised against the LIVE gateway before it is
   * trusted on a customer charge.
   *
   * Unlike capture.ts this does NOT reconcile against `amount`: the whole point
   * of the POC is to send a deliberately-chosen body and see what SUMIT does
   * with it, including a combination the production guard would refuse. SUMIT
   * charges the sum of these rows, so `amount` is ignored when they are present
   * — the screen says so, and the safe preview shows the exact rows sent.
   */
  lines?: RawChargeLine[];
}

/** One POC Items row. `unitPrice` may be negative (credit-line experiments). */
export interface RawChargeLine {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface SumitRawResult {
  httpStatus: number;
  ok: boolean;
  // The exact request body sent, with Credentials redacted — for the POC display.
  sentBody: Record<string, unknown>;
  raw: unknown; // full parsed JSON (or raw text if not JSON)
}

export async function chargeRaw(p: SumitRawChargeParams): Promise<SumitRawResult> {
  const body: Record<string, unknown> = {
    Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
    Customer: {
      ID: p.customerId, // present → reuse that SUMIT customer; absent → create/search
      EmailAddress: p.customerEmail || undefined,
      ExternalIdentifier: p.externalId,
    },
    VATIncluded: true,
    Items:
      p.lines && p.lines.length > 0
        ? p.lines.map((l) => ({
            Quantity: l.quantity,
            UnitPrice: l.unitPrice,
            Item: { Name: l.name },
            Description: l.name,
          }))
        : [
            {
              Quantity: 1,
              UnitPrice: parseFloat(p.amount),
              // SUMIT requires the Item object (IncomeItem.Name), not just a line
              // Description — a Description-only item returns BusinessError
              // "Missing Item details" (verified against the live API).
              Item: { Name: 'KALFA — בדיקת POC' },
              Description: 'KALFA — בדיקת POC',
            },
          ],
    AutoCapture: p.autoCapture,
    SendDocumentByEmail: true,
    DraftDocument: false,
  };
  // Saved reusable token (route B) → PaymentMethod.CreditCard_Token; otherwise the
  // single-use token from payments.js. PaymentMethod and SingleUseToken are
  // mutually exclusive per the SUMIT spec.
  if (p.savedCardToken) {
    // Type:1 (CreditCard) is REQUIRED — a saved-token charge without it returns
    // Status 1 "Type should be set to CreditCard or DirectDebit" (verified live
    // 2026-07-01). Expiry + CitizenID accompany the token, mirroring the
    // production capture.ts PaymentMethod exactly (route.ts enforces these as
    // mandatory before calling chargeRaw — see its route-B validation).
    body.PaymentMethod = {
      CreditCard_Token: p.savedCardToken,
      CreditCard_ExpirationMonth: p.savedCardExpMonth,
      CreditCard_ExpirationYear: p.savedCardExpYear,
      CreditCard_CitizenID: p.savedCardCitizenId,
      // Omitted entirely when absent — an explicit null is a DIFFERENT body to
      // the one production sends, which is the exact trap the VATRate field
      // fell into here.
      ...(p.savedCardCvv ? { CreditCard_CVV: p.savedCardCvv } : {}),
      Type: 1,
    };
  } else {
    body.SingleUseToken = p.ogToken;
  }
  // VATRate is sent ONLY when the operator typed one. The business is an עוסק
  // פטור: production (authorize.ts / capture.ts) sends no VAT fields at all and
  // lets the company default balance the document. This module used to send an
  // explicit rate on the new-card path (defaulted to 18 in the form) and an
  // explicit `null` on the saved-token path — neither matched what production
  // puts on the wire, so a POC result did not predict production behaviour. An
  // absent field is now absent, exactly as in production.
  if (p.vatRate && p.vatRate.trim() !== '') {
    const rate = parseFloat(p.vatRate);
    if (Number.isFinite(rate)) body.VATRate = rate;
  }
  if (p.authorizeAmount && p.authorizeAmount.trim() !== '') {
    body.AuthorizeAmount = parseFloat(p.authorizeAmount);
  }
  if (typeof p.cardTokenNotNeeded === 'boolean') {
    body.CardTokenNotNeeded = p.cardTokenNotNeeded;
  }
  if (typeof p.preventDocumentCreation === 'boolean') {
    body.PreventDocumentCreation = p.preventDocumentCreation;
  }

  const res = await fetch(SUMIT_CHARGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }

  // Echo the request body with credentials stripped (never surface the API key).
  const sentBody = { ...body, Credentials: { CompanyID: p.companyId, APIKey: '***' } };

  return { httpStatus: res.status, ok: res.ok, sentBody, raw };
}
