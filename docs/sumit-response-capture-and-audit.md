# SUMIT response capture & audit — maximizing documented parameters

**Purpose.** Improve the SUMIT (`/billing/payments/charge/`) integration so we capture the
**maximum useful, permitted** set of response parameters for documentation, reconciliation,
and dispute resolution — **without** storing anything PCI/PII forbids. This document is the
reference + the improvement plan; it does not itself change code.

**Status.** Documentation + recommendation. Code changes are gated on explicit approval.

## Live sources (non-local, fetched 2026-07-01)

- **SUMIT response schema** — the live OpenAPI spec: `https://api.sumit.co.il/swagger/v1/swagger.json`
  (Swagger UI: `https://app.sumit.co.il/help/developers/swagger/index.html`). Every field
  description below is a verbatim quote from this spec.
- **PCI-DSS card-data storage** — [PCI SSC FAQ — CVV storage](https://www.pcisecuritystandards.org/faq/articles/Frequently_Asked_Question/can-card-verification-codes-values-be-stored-for-card-on-file-or-recurring-transactions/);
  [PCI DSS Data Storage Do's & Don'ts](https://listings.pcisecuritystandards.org/pdfs/pci_fs_data_storage.pdf).
- **Logging hygiene** — [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
- **Gateway reconciliation / idempotency patterns** — [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests);
  [Adyen API idempotency](https://docs.adyen.com/development-resources/api-idempotency);
  [Adyen referenced refunds (reconcile by provider id)](https://docs.adyen.com/unified-commerce/referenced-refunds);
  [Adyen webhooks](https://docs.adyen.com/development-resources/webhooks).
- **Append-only audit pattern** — [Azure Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing).
- **Israeli privacy (CitizenID)** — [IAPP: Amendment 13](https://iapp.org/news/a/israel-marks-a-new-era-in-privacy-law-amendment-13-ushers-in-sweeping-reform)
  (in force 2025-08-14); [Library of Congress](https://www.loc.gov/item/global-legal-monitor/2025-11-17/israel-amendment-to-privacy-protection-law-goes-into-effect/).

---

## 1. The complete response schema (the "max parameters")

`POST /billing/payments/charge/` → `Response_…PaymentsController_Payments_Charge_Response`.
Every object is `additionalProperties:false`, so this is the **full** field set the endpoint
can return. Sensitivity column drives the redaction rules in §3.

### Envelope
| path | type | swagger description | sensitivity |
|---|---|---|---|
| `Status` | enum | "Response status" — `Success (0)` / `BusinessError (1)` / `TechnicalError (2)` | safe |
| `UserErrorMessage` | string? | "Error message, in a user readable format" | safe |
| `TechnicalErrorDetails` | string? | "Technical error details, let us know if you received this." | safe |
| `Data` | object | "API specific response data" | — |

### `Data`
| path | type | swagger description | sensitivity |
|---|---|---|---|
| `Data.DocumentID` | int64? | "Document ID (OfficeGuy identifier)" | safe — **reconciliation key** |
| `Data.DocumentNumber` | int64? | "Document number" | safe |
| `Data.CustomerID` | int64? | "Customer number" | safe — reconciliation key |
| `Data.DocumentDownloadURL` | string? | "Document download URL…" | safe (signed link) |
| `Data.Payment` | `Typed.Payment` | (no description in spec) | — |

### `Data.Payment`
| path | type | swagger description | sensitivity |
|---|---|---|---|
| `.ID` | int64 | "Payment identifier" | safe — **reconciliation key** |
| `.CustomerID` | int64 | "Customer identifier" | safe |
| `.Date` | date-time? | "Payment date" | safe |
| `.ValidPayment` | bool | "Indicates if the payment is valid" | safe — **decline detector** |
| `.Status` | string? | "Payment status" | safe |
| `.StatusDescription` | string? | "Payment status description" | safe |
| `.Amount` | double | "Payment amount" | safe |
| `.Currency` | enum | (no description) — `ILS (0)`/`USD (1)`/… | safe |
| `.AuthNumber` | string? | "Authorization number" | safe (transaction ref) |
| `.FirstPaymentAmount` | double? | "First credit card installments payment amount" | safe (n/a to us) |
| `.NonFirstPaymentAmount` | double? | "Non first credit card installments payment amount" | safe (n/a to us) |
| `.RecurringCustomerItemIDs` | int64[]? | "Relevant only for payments originating from recurring payments" | safe (n/a to us) |
| `.PaymentMethod` | `Typed.PaymentMethod` | "Payment method details" | — |

### `Data.Payment.PaymentMethod`
| path | type | swagger description | sensitivity |
|---|---|---|---|
| `.ID` | int64? | (no description in spec) | safe |
| `.CustomerID` | int64? | (no description in spec) | safe |
| `.Type` | enum | "Payment method type" — `Other (0)`/`CreditCard (1)`/`DirectDebit (2)` | safe |
| `.CreditCard_Token` | string? | "Credit card token" | **secret-equivalent** — guard |
| `.CreditCard_LastDigits` | string? | "Credit card last 4 digits\nShouldn't be input by API caller" | safe (masked) |
| `.CreditCard_CardMask` | string? | "Credit card mask\nShouldn't be input by API caller" | safe (masked) |
| `.CreditCard_ExpirationMonth` | int32? | "Credit card expiration month (1-2 digits)…" | cardholder data — OK to store |
| `.CreditCard_ExpirationYear` | int32? | "Credit card expiration year (4 digits)…" | cardholder data — OK to store |
| `.CreditCard_CitizenID` | string? | "Credit card owner Israel Citizen ID / Passport Number…" | **PII** — minimize (§3) |
| `.CreditCard_Number` | string? | "Credit card full number…" | 🔴 **PAN — NEVER store** |
| `.CreditCard_CVV` | string? | "Credit card CVV/CVV2…" | 🔴 **SAD — NEVER store** |
| `.CreditCard_Track2` | string? | "Credit card Track2" | 🔴 **SAD — NEVER store** |
| `.DirectDebit_Bank`/`_Branch`/`_Account` | int64? | bank account details | PII (n/a — we're card-only) |
| `.DirectDebit_ExpirationDate`/`_MaximumAmount` | — | direct-debit fields | n/a |

---

## 2. Gap: captured today vs available

Current adapters (`src/lib/sumit/{authorize,capture,charge}.ts`) parse only a subset:

| adapter | captures today | notable SAFE fields it DROPS |
|---|---|---|
| `authorize.ts` (J5 hold) | `Payment.AuthNumber`, `Payment.ValidPayment`, `PaymentMethod.CreditCard_Token`, `_ExpirationMonth/Year`, `_CitizenID` | `Payment.ID`, `Payment.Date`, `Payment.Status`+`StatusDescription`, `Payment.Amount`+`Currency`, `Data.CustomerID`, `CreditCard_LastDigits`, `CreditCard_CardMask`, `PaymentMethod.ID` |
| `capture.ts` (final charge) | `Data.DocumentID`, `DocumentNumber`, `DocumentDownloadURL`, `Payment.AuthNumber`, `Payment.ID` | `Payment.Date`, `Payment.Status`+`StatusDescription`, `Payment.Amount`+`Currency`, `Data.CustomerID`, `CreditCard_LastDigits`/`CardMask` |
| `charge.ts` (orders J4) | `Data.DocumentID` only (and the **wrong** `Status.IsError` shape — see `docs/sumit-payments-implementation.md`) | everything above |

**Two distinct improvements** follow: (A) capture more safe **columns**; (B) persist a
redacted **per-attempt audit record** (the durable "document of the process").

---

## 3. Data classification (drives redaction)

- **🔴 NEVER persist (PCI SAD / PAN):** `CreditCard_Number` (store **last-4 only** via
  `CreditCard_LastDigits`), `CreditCard_CVV`, `CreditCard_Track2`. SAD must never be stored
  after authorization, even encrypted [PCI SSC FAQ; PCI Do's & Don'ts]. Never log raw [OWASP].
- **🟡 PII — minimize:** `CreditCard_CitizenID`. A teudat-zehut is personal data; Amendment 13
  (2025-08-14) tightens handling and permits suits without proof of harm [IAPP; LoC]. We
  already store it because SUMIT **requires** it at capture ([[sumit-charge-verified-behavior]]);
  do **not** duplicate it into any new audit row — keep the single copy on `campaigns`, anchored
  in the signed agreement.
- **🟠 Secret-equivalent — guard:** `CreditCard_Token` (a pseudonym, not a PAN, but re-usable).
  Server-only; never to the browser/logs.
- **🟢 Safe to persist (documentation/reconciliation):** all IDs (`Payment.ID`,
  `Data.CustomerID`, `DocumentID`, `DocumentNumber`), `AuthNumber`, `Payment.Status`+
  `StatusDescription`, `ValidPayment`, `Amount`+`Currency`, `Payment.Date`, `CreditCard_LastDigits`,
  `CreditCard_CardMask`, expiry, `DocumentDownloadURL`, our correlation id, HTTP status,
  request/response timestamps [PCI FAQ; Stripe; Adyen; OWASP].

---

## 4. Recommended improvements

### (A) Capture more safe columns at the source
Extend the adapter return types + `recordCampaignHold` / `recordCampaignCharge` to also persist
the SAFE fields currently dropped — most valuable for reconciliation & display:
- `Payment.Status` + `Payment.StatusDescription` (granular gateway status, beyond our
  `capture_status`/`charge_status`).
- `Data.CustomerID` (SUMIT customer id — a reconciliation key the dashboard/API accept, unlike
  our `ExternalIdentifier`, which is **not** queryable at transaction level — see
  `docs/sumit-payments-implementation.md` / reconcile route).
- `Payment.Amount` + `Currency` (what SUMIT actually settled — cross-check vs our computed amount).
- `CreditCard_LastDigits` + `CreditCard_CardMask` (safe masked card, for owner-facing display &
  support).
- `Payment.Date` (authoritative gateway timestamp).

### (B) Append-only, redacted per-attempt audit table
The durable "document of the process". Every hold/charge attempt writes ONE immutable row —
before/independent of the outcome branch — mirroring the event-sourcing + OWASP "who/when/what/
result" shape [Azure Event Sourcing; OWASP].

Proposed `payment_events` (append-only; RLS admin/service-role only):

| column | source | notes |
|---|---|---|
| `id` uuid pk | generated | |
| `campaign_id` uuid | our context | scope |
| `kind` text | our code | `hold` / `charge` |
| `correlation_id` text | our `authRef` (`Customer.ExternalIdentifier`) | idempotency/anchor [Stripe; Adyen] |
| `http_status` int | fetch `res.status` | [OWASP result status] |
| `outcome` text | derived | `authorized`/`declined`/`review`/`billed` |
| `sumit_status` text | `Status` enum | `Success (0)`/`BusinessError (1)`/`TechnicalError (2)` |
| `valid_payment` bool | `Payment.ValidPayment` | the true decline detector |
| `payment_id` int8 | `Payment.ID` | **reconciliation key** |
| `document_id` int8 | `Data.DocumentID` | **reconciliation key** |
| `customer_id` int8 | `Data.CustomerID` | reconciliation key |
| `auth_number` text | `Payment.AuthNumber` | |
| `amount` numeric | `Payment.Amount` | |
| `currency` text | `Payment.Currency` | |
| `card_last4` text | `CreditCard_LastDigits` | masked — safe |
| `raw_response` jsonb | **redacted** full body | see (C) |
| `created_at` timestamptz | `now()` | |

Deliberately **absent**: PAN, CVV, Track2 (never), `CreditCard_Token` & `CitizenID` (kept only
on `campaigns`, not duplicated here).

### (C) Redaction-at-write serializer (the core safety rule)
Never persist a raw gateway body. Route every response through an **allow-list** serializer that
runs **before** insert and drops/reduces the forbidden fields [OWASP; PCI]:
- delete `PaymentMethod.CreditCard_Number`, `CreditCard_CVV`, `CreditCard_Track2` entirely;
- keep `CreditCard_LastDigits`/`CardMask` (already masked);
- redact `CreditCard_Token` → store only a boolean `had_token` in `raw_response` (the real token
  stays in the `campaigns` column, server-only);
- redact `CreditCard_CitizenID` → drop from `raw_response` (single copy lives on `campaigns`).
A single `redactSumitResponse(raw)` helper in `src/lib/sumit/` used by every adapter + the
`/admin/sumit-test` tool guarantees no path can persist/return an unfiltered body.

### (D) Reconciliation, grounded
- Reconcile by `payment_id` / `document_id` (both stored) via `/billing/payments/get/` and
  `/accounting/documents/getpdf/`. **Not** by `ExternalIdentifier` — the live swagger confirms it
  is a *customer* field, not a transaction query key.
- Adopt idempotency discipline [Stripe; Adyen]: `correlation_id` per attempt makes duplicate
  submits reconcilable.

---

## 5. Explicit non-goals / cautions
- Do **not** add SUMIT webhooks as an audit source yet: the native Triggers API exposes **no
  documented signature/secret** for authenticity verification (live-swagger confirmed) — an
  unauthenticated audit source is worse than none.
- Do **not** widen `CitizenID` storage; Amendment 13 pushes toward minimization.
- The `charge.ts` (orders) `Status.IsError` bug is pre-existing and tracked separately in
  `docs/sumit-payments-implementation.md`; align it to the swagger `Status` enum when touched.

## 6. Suggested sequencing
1. `redactSumitResponse()` helper + unit tests (RED/GREEN) — the safety primitive first.
2. Extend adapter return types to expose the SAFE dropped fields (no storage yet).
3. Migration: safe columns on `campaigns` (or the `payment_events` table) — isolated-PG tested.
4. Wire `recordCampaignHold`/`recordCampaignCharge` + the two routes to write the audit row via
   the redactor.
5. A reconciliation reader (`/billing/payments/get/` by `payment_id`) for the admin panel.

---

## 7. Real captured responses (live POC, 2026-07-01) — REDACTED

Captured via `/admin/sumit-test` against the LIVE API. **Redacted per §3**: `CreditCard_CitizenID`,
`CreditCard_Token`, `AuthNumber`, and customer IDs replaced with `***`; `CreditCard_LastDigits`/
`CardMask` kept (already masked, safe). These are the authoritative ground-truth shapes.

### 7a. J5 hold — SUCCESS (₪1, `AutoCapture:false`, `PreventDocumentCreation:true`)
Request: `SingleUseToken` + `AuthorizeAmount:1`. Response (redacted):
```jsonc
{
  "Data": {
    "Payment": {
      "ID": 0,                       // ⚠️ 0 on a HOLD (not a usable key yet)
      "CustomerID": 0,
      "Date": "2026-07-01T05:35:04+03:00",
      "ValidPayment": true,          // the real success detector
      "Status": "000",               // string; StatusDescription: "מאושר (קוד 000)"
      "StatusDescription": "מאושר (קוד 000)",
      "Amount": 1,
      "Currency": 0,                 // 0 = ILS
      "PaymentMethod": {
        "ID": 2078931957,
        "CreditCard_Number": null,   // ✅ PAN never returned
        "CreditCard_CVV": null,      // ✅ SAD never returned
        "CreditCard_Track2": null,   // ✅
        "CreditCard_LastDigits": "9183",
        "CreditCard_CardMask": "XXXXXXXXXXXX9183",
        "CreditCard_ExpirationMonth": 7,
        "CreditCard_ExpirationYear": 2031,
        "CreditCard_CitizenID": "***",   // PII — present in the response
        "CreditCard_Token": "***",       // secret-equivalent — present
        "Type": 1                        // CreditCard
      },
      "AuthNumber": "***"
    },
    "DocumentID": null,              // ⚠️ null on a HOLD (PreventDocumentCreation)
    "DocumentNumber": null,
    "CustomerID": 2078931956,       // top-level: the created customer
    "DocumentDownloadURL": null
  },
  "Status": 0,                       // ⚠️ NUMBER 0, not the swagger string "Success (0)"
  "UserErrorMessage": null,
  "TechnicalErrorDetails": null
}
```

**Refinements this proves (correct the earlier assumptions):**
- **Top-level `Status` is NUMERIC `0`** at runtime, not the swagger's string `"Success (0)"`.
  Our adapters' numeric check (`Status === 0` / `!= 0`) is validated. `Payment.Status` is the
  string `"000"`.
- **HOLD vs CHARGE key population differs:** on a J5 hold, `Payment.ID = 0` and
  `DocumentID/DocumentNumber/DocumentDownloadURL = null` — they only populate at the real charge.
  So a HOLD's reconciliation anchors are **`AuthNumber` + top-level `Data.CustomerID` +
  our `ExternalIdentifier` + `CreditCard_Token`** — NOT `Payment.ID`/`DocumentID`. The
  `payment_events` table (§4B) must tolerate null `payment_id`/`document_id` for holds.
- `CreditCard_Number`/`CVV`/`Track2` come back **null** — SUMIT never returns them, so the
  §3 "never store" set is naturally satisfied; `CitizenID`, `Token`, last-4, expiry DO come back.

### 7b. Saved-token charge — FAILURE (missing `Type`)
Request: `AutoCapture:true` + `PaymentMethod:{ CreditCard_Token }` (no `Type`). Response:
```jsonc
{
  "Data": null,
  "Status": 1,                       // NUMBER 1 = BusinessError (definitive decline)
  "UserErrorMessage": "Can't create non CreditCard/DirectDebit method. Type should be set to CreditCard or DirectDebit.",
  "TechnicalErrorDetails": null
}
```
**Proves:** a saved-token charge **requires `PaymentMethod.Type: 1`** (and, per `capture.ts` +
the memory reference, also `CreditCard_ExpirationMonth/Year` and `CreditCard_CitizenID`). The
production `capture.ts` already supplies all of these; the POC `raw-charge.ts` was missing `Type`
and is now fixed. Also confirms **top-level `Status` is numeric `1`** on a business error
(matching 7a's numeric `0`), and `Data` is `null` on failure.
