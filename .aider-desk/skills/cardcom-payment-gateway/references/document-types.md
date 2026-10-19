# Cardcom V11 Israeli Tax Document Types

All field names and enum values below are taken from the official Cardcom V11
OpenAPI specification at `https://secure.cardcom.solutions/Api/v11/Docs`
(the `Document`, `DocumentBase`, `DocumentToCreate`, and `Products` schemas).

## DocumentTypeToCreate (string enum)

The document type is set with the `DocumentTypeToCreate` string field on the
`Document` object. It is a STRING enum, NOT an integer code. The full
`DocumentToCreate` enum from the V11 schema:

| Value | Hebrew | English | Typical Use |
|-------|--------|---------|-------------|
| `Auto` | --- | Auto | Default; uses your admin-panel configuration |
| `TaxInvoiceAndReceipt` | hashbonit mas / kabala | Tax Invoice + Receipt | B2C with payment (most common) |
| `TaxInvoiceAndReceiptRefund` | --- | Tax Invoice + Receipt Refund | Reversing a `TaxInvoiceAndReceipt` |
| `Receipt` | kabala | Receipt | Payment confirmation only |
| `ReceiptRefund` | --- | Receipt Refund | Reversing a `Receipt` |
| `Quote` | hatzaat mehir | Quote | Price quote, no financial effect |
| `Order` | hazmana | Order | Customer order document |
| `OrderConfirmation` | ishur hazmana | Order Confirmation | Confirms an order |
| `OrderConfirmationRefund` | --- | Order Confirmation Refund | Reverses an order confirmation |
| `DeliveryNote` | teudat mishloach | Delivery Note | Goods delivery |
| `DeliveryNoteRefund` | --- | Delivery Note Refund | Reverses a delivery note |
| `ProformaInvoice` | hashbonit iska / proforma | Proforma Invoice | Pre-sale document |
| `ProformaInvoiceRefund` | --- | Proforma Invoice Refund | Reverses a proforma invoice |
| `DemandForPayment` | drishat tashlum | Demand for Payment | Payment demand |
| `DemandForPaymentRefund` | --- | Demand for Payment Refund | Reverses a demand for payment |
| `ProformaDealInvoice` | --- | Proforma Deal Invoice | Proforma tied to a deal |
| `ProformaDealInvoiceRefund` | --- | Proforma Deal Invoice Refund | Reverses a proforma deal invoice |
| `TaxInvoice` | hashbonit mas | Tax Invoice | B2B, when the receipt is issued separately |
| `TaxInvoiceRefund` | --- | Tax Invoice Refund | Reverses a `TaxInvoice` |
| `ReceiptForTaxInvoice` | kabala al heshbon hashbonit mas | Receipt for Tax Invoice | Receipt against a prior tax invoice |
| `ReceiptForTaxInvoiceRefund` | --- | Receipt for Tax Invoice Refund | Reverses a receipt-for-tax-invoice |
| `DonationReceipt` | kabalat trumot | Donation Receipt | Registered non-profits |
| `DonationReceiptRefund` | --- | Donation Receipt Refund | Reverses a donation receipt |
| `CouponDocumentAndReceipt` | --- | Coupon Document and Receipt | Coupon sale plus receipt |
| `CouponDocumentAndReceiptRefund` | --- | Coupon Document and Receipt Refund | Reverses a coupon document and receipt |

If you need a value not listed, verify it against the official docs rather than
guessing.

## When to Use Each Type (Israeli Tax Law)

- **`TaxInvoice`:** Required when supplying goods/services to a business. The
  buyer needs it to claim an input-VAT deduction, and above the statutory threshold that
  deduction ALSO requires an allocation number (mispar haktzaa) on the invoice. The
  threshold is 5,000 NIS pre-VAT from 1 June 2026 (10,000 from 1 January 2026, 20,000 in
  2025, 25,000 from May 2024). Cardcom requests the number automatically at document creation,
  but only while its Israel Invoices registration is active (a three-month verification
  code); see SKILL.md Step 4.5. Issuing the
  document is not the whole of compliance. Issue at the time of supply or
  payment, whichever is earlier.
- **`Receipt`:** Confirms payment was received. Does NOT replace a tax invoice.
- **`TaxInvoiceAndReceipt`:** Combined document for when payment and supply
  happen simultaneously. Standard for most B2C retail and e-commerce.
- **`*Refund` types:** Required when reversing a previous document (refunds,
  price reductions, returned goods).
- **Osek Patur** (exempt dealer): issues a `Receipt` only, not tax invoices.

## Document Object Fields

V11 has three document objects, all built on `DocumentBase` and all with
`additionalProperties: false`, so a field that belongs to one of them is not part of the others (the server may reject or ignore it; neither does what you meant):

| Object | Used in | Required |
|--------|---------|----------|
| `Document` | `Documents/CreateDocument` (standalone) | `Name`, `DocumentTypeToCreate` |
| `DocumentLP` | `LowProfile/Create` | `Name` |
| `DocumentTran` | `Transactions/Transaction` | `Name` |

### Fields on all three (DocumentBase)

| Field | Type | Notes |
|-------|------|-------|
| `DocumentTypeToCreate` | string enum | One of the values above; `Auto` uses your admin-panel configuration. Required on `Document` |
| `Name` | string | The "document To" / customer name, 1-50 chars. Required |
| `TaxId` | string | Business registration number or ID number (replaces the older `VAT_Number`) |
| `Email` | string | Email to send the document to, max 50 chars |
| `IsSendByEmail` | bool | `true` to auto-email the PDF (default `true`) |
| `AddressLine1` / `AddressLine2` / `City` | string | Customer address |
| `Mobile` / `Phone` | string | Customer phone numbers |
| `Comments` | string | Free text printed on the document, max 250 chars |
| `IsVatFree` | bool | `true` if every line in the document is VAT-free |
| `DepartmentId` | int | Department id from the admin panel, for reports |
| `ExternalId` | string | Your custom id stored on the document |
| `DeliveryName` | string | Delivery method name |
| `AdvancedDefinition` | object | Advanced document definition |
| `Products` | array | See the Products fields below |

### Fields on only some of them

| Field | `Document` | `DocumentLP` | `DocumentTran` | Notes |
|-------|:---:|:---:|:---:|-------|
| `Languge` (misspelled) | yes | no | yes | `Document`: `he` (default) or `en`; `DocumentTran`: `he`/`en`/`ru`/`ar`/`fr`/`it` |
| `Language` (correct spelling) | no | yes | no | `Languge` is not a field here |
| `ISOCoinID` / `ISOCoinName` | yes | no | no | Currency of a standalone document. In the payment flows the currency comes from the request's own `ISOCoinId` |
| `DocumentDate` | yes | no | no | |
| `DocumentDateDDMMYYYY` | no | no | yes | |
| `ManualNumber`, `ValueDate` | yes | no | yes | |
| `IsAllowEditDocument`, `IsShowOnlyDocument` | no | yes | no | Hosted-page document options |
| `IsSendSMS` | no | no | yes | |

## Products Array Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `Description` | string | Yes | Line item description, 1-250 chars |
| `UnitCost` | decimal | Yes | Cost of one unit |
| `Quantity` | decimal | No | Quantity, default `1` |
| `TotalLineCost` | decimal | No | Send when `Quantity` has decimals, to prevent rounding errors |
| `IsVatFree` | bool | No | `true` for a VAT-free line, for mixed-VAT documents |
| `ProductID` | string | No | Your internal SKU / product id |
| `IsGiftCard` | bool | No | `true` creates a non-financial gift-card document type |

## Allocation numbers: older documents and exclusions

- The regime began in May 2024. Invoices dated before that never needed a number.
- The threshold is keyed to the DOCUMENT's own date. When reissuing, migrating or auditing
  older documents, test each against the threshold in force on its date, not today's 5,000.
- The statute (VAT Law s.38(a1)) says `עולה על` (EXCEEDS), so a document exactly at the
  threshold is outside it.
- An osek patur is unaffected: they do not issue tax invoices and do not deduct input VAT.
- Zero-rated invoices are outside the requirement (s.47(a2)(1) applies only where the tax is
  "אינו בשיעור אפס"), so an export invoice does not need a number however large.
- If an integration was written earlier in 2026 against the 10,000 figure, invoices between
  5,000 and 10,000 are the band to re-check.

## VAT Handling

- The current Israeli VAT rate is 18% (effective January 2025).
- Set `IsVatFree: true` on a single product line for a VAT-exempt line item.
- Set `IsVatFree: true` on the `Document` object for a fully VAT-free document.
- Mixed documents: set `IsVatFree` per line item.
- **Osek Patur** (exempt dealer): should issue `Receipt` documents only.

## Example: Tax Invoice + Receipt

```json
{
  "ApiName": "your-api-name",
  "ApiPassword": "your-api-password",
  "Document": {
    "DocumentTypeToCreate": "TaxInvoiceAndReceipt",
    "Name": "Israel Israeli",
    "Email": "customer@example.com",
    "IsSendByEmail": true,
    "Languge": "he",
    "ISOCoinID": 1,
    "Products": [
      { "Description": "Annual software license", "UnitCost": 1180.00, "Quantity": 1 },
      { "Description": "Setup fee", "UnitCost": 236.00, "Quantity": 1 }
    ]
  }
}
```

Cardcom computes the VAT server-side from the line totals.
