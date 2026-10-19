# Cardcom REST API V11 Endpoint Reference

All endpoint paths, request fields, and response fields below are taken from the
official Cardcom V11 OpenAPI specification at
`https://secure.cardcom.solutions/Api/v11/Docs`.

## Base URL & Authentication

- **Base:** `https://secure.cardcom.solutions/api/v11/`
- **Auth fields differ by endpoint family, so copy them from the schema:**
  - `ApiName` (+ `ApiPassword` where required): LowProfile, Transactions (except
    `GetTransactionInfoById`), Documents, SuspendedDeals, Financial, Account, TapTransactions.
  - `apiUserName` / `apiPassword` (lowercase a): `RecuringPayments/GetRecurringPayment`,
    `GetRecurringPaymentHistory`, `GetMuhlafimByDate`, `IsBankNumberValid`;
    `ApiUserName` / `ApiPassword` on `ChangeStatusForHistoryRecurringToIrrevocable`;
    `UserName` / `Password` on `GetMuhlafim`; `SupplierUserName` / `Secret` on `GetMuhlafimFile`.
  - `UserName` / `UserPassword`: `Transactions/GetTransactionInfoById`.
  - `SupplierUserName` / `SupplierPassword` / `Secret`: most `CompanyOperations` writes.
  - `TerminalNumber` (integer) is a field on LowProfile, `Transaction`, `GetTransactionByExternalUniqTran`,
    `GetTransactionInfoById`, SuspendedDeals, TapTransactions and `ExternalShopCreateDocument`, but NOT on
    `CreateDocument`, `CancelDoc`, `RefundByTransactionId`, `ListTransactions`, `SpecialTransactions`
    or the other Documents and Financial calls. Every schema is marked
    `additionalProperties: false`, so do not add it where it is not listed.
  `ApiPassword` (string) is listed in `required` by 26 V11 request schemas in the October 2026 spec,
  including `CreateDocument`, `CancelDoc`, `SendAllDocumentsToEmail`, `GetReport`, `CreateDocumentUrl`,
  the `Financial/*` reports, `Account/GetByAccountId`, the `TapTransactions/*` device and transaction
  calls, and `Transactions/{ListTransactions, RefundByTransactionId, SpecialTransactions}`.
  `Documents/ExternalShopCreateDocument` also requires it in the current spec (an earlier revision
  had no such property), while `Documents/CrossDocument` declares no `required` array. The list
  drifts between revisions, so re-read the schema.
  The rule of thumb is that company-wide reads and writes need it and single-card charges
  do not. It is not a property at all on `LowProfile/Create` or `Transactions/Transaction`.
  Authoritative check: the `required` array of the endpoint's request schema in
  `https://secure.cardcom.solutions/swagger/v11/swagger.json`.
- **Test terminal:** `1000`; its API username and password come from Cardcom support (not published).
  Israeli test card `4580280000000008`, tourist test card `4580000000000000`, any future expiry,
  CVV `123`. Under 5,000 NIS simulates success, above 5,000 NIS a failure. A real card on the test
  terminal is not charged but has the amount held for three days. Source: Cardcom's developer
  test-information page (SKILL.md Step 2).
- **Method:** All endpoints are `POST` with `Content-Type: application/json`
  (except a few `RecuringPayments` / `CompanyOperations` lookups that are `GET`).
- **Response shape:** the endpoints this skill uses return `ResponseCode` (integer, `0` = success)
  and `Description`. Not all do: `GetTransactionInfoById` and the `CompanyOperations` lookups
  return bare arrays, and some `Financial` transfer calls return a bare boolean.

## LowProfile (Hosted Payment Page)

| Endpoint | Purpose | Key Request Fields | Key Response Fields |
|----------|---------|-------------------|-------------------|
| `LowProfile/Create` | Create hosted payment page | `TerminalNumber`, `ApiName`, `Operation`, `Amount`, `SuccessRedirectUrl`, `FailedRedirectUrl`, `WebHookUrl`, `ISOCoinId`, `Language`, `ReturnValue`, `Document` | `ResponseCode`, `Description`, `LowProfileId`, `Url`, `UrlToBit`, `UrlToPayPal` |
| `LowProfile/GetLpResult` | Retrieve payment result | `TerminalNumber`, `ApiName`, `LowProfileId` | `ResponseCode`, `Description`, `TranzactionId`, `ReturnValue`, `TranzactionInfo`, `TokenInfo`, `DocumentInfo`, `SuspendedInfo` |

`Operation` enum: `ChargeOnly` (default), `ChargeAndCreateToken`, `CreateTokenOnly`,
`SuspendedDeal`, `Do3DSAndSubmit`.

## Transactions

| Endpoint | Purpose | Key Request Fields | Key Response Fields |
|----------|---------|-------------------|-------------------|
| `Transactions/Transaction` | Charge a card or a token (server-to-server) | `TerminalNumber`, `ApiName`, `Amount`, `Token` or `CardNumber`, `CardExpirationMMYY`, `CVV2`, `ISOCoinId`, `Document`, `Advanced` | `ResponseCode`, `Description`, `TranzactionId`, `Token`, `ApprovalNumber`, `DocumentNumber`, `DocumentUrl` |
| `Transactions/RefundByTransactionId` | Refund a transaction | `ApiName`, `ApiPassword`, `TransactionId`, `PartialSum`, `CancelOnly`, `AllowMultipleRefunds` | `ResponseCode`, `Description`, `NewTranzactionId` |
| `Transactions/GetTransactionInfoById` | Get single transaction details | `TerminalNumber`, `UserName`, `UserPassword`, `InternalDealNumber` (ALL four required; this endpoint uses `UserName`/`UserPassword`, NOT `ApiName`/`ApiPassword`, and the id field is `InternalDealNumber`, not `TransactionId`. The schema sets `additionalProperties: false`, so do not send `ApiName`) | NOT a `ResponseCode` object: the 200 response is a JSON ARRAY of `ExtShvaParams` records (raw Shva fields) |
| `Transactions/ListTransactions` | List transactions by date range | `ApiName`, `ApiPassword`, `FromDate`, `ToDate`, `Page`, `Page_size` (ALL six required; dates are `DDMMYYYY` strings, `Page` starts at 1, `Page_size` is 10-2000). Optional: `TranStatus` (default `Success`), `LimitForTerminal`. There is NO `TerminalNumber` field (the schema is `additionalProperties: false`), so do not send one; use `LimitForTerminal` to scope to a terminal | `ResponseCode`, `Description`, `Tranzactions` (array of `TransactionInfo`), `Page`, `Page_size` |
| `Transactions/SpecialTransactions` | READ-only: returns other transactions when Cardcom is your acquirer. Despite the name it does not create or charge anything | `ApiName`, `ApiPassword`, `FromDate`, `ToDate` (ALL four required, and these are the ONLY four properties; dates are `DDMMYYYY`. No `TerminalNumber`, no `Amount`; `additionalProperties: false`) | `ResponseCode`, `Description` |
| `Transactions/GetTransactionByExternalUniqTran` | Check whether a charge with your `ExternalUniqTranId` succeeded (use after a timeout, before any retry) | `TerminalNumber`, `ApiName` (both required), `ExternalUniqTranId`, `ExternalMerchantId` | `TransactionInfo` |

`700`/`701` are the answers to J2/J5 validation-only checks (`CreateTokenOnly`, `SuspendedDeal`).
They are success for THAT check but mean nothing was charged; never accept them on a charge.
`608` means the `ExternalUniqTranId` was already used by a call that got a valid answer (a charge, or a J2/J5
check): look that record up with `GetTransactionByExternalUniqTran`, never re-charge under a new id.

## Documents

| Endpoint | Purpose | Key Request Fields | Key Response Fields |
|----------|---------|-------------------|-------------------|
| `Documents/CreateDocument` | Create standalone invoice/receipt | `ApiName`, `ApiPassword`, `Document` (see document-types.md), `Cash`, `Cheques` | `ResponseCode`, `Description`, `DocumentType`, `DocumentNumber`, `AccountId`, `DocumentUrl` |
| `Documents/CancelDoc` | Spec summary: "Cancel document and refund credit card". Do not combine with `RefundByTransactionId` for the same refund | `ApiName`, `ApiPassword`, `DocumentNumber`, `DocumentType` (all required; `DocumentType` is an INTEGER here). Optional `IsCancelEmailSend`, `IsSendSMS`, `IsCreditCardCancelOnly` | `ResponseCode`, `Description`, `NewDocumentNumber`, `NewDocumentType`, `AccountID` |
| `Documents/SendAllDocumentsToEmail` | Email the PDFs of all documents in a DATE RANGE | `ApiName`, `ApiPassword`, `EmailTo`, `FromDateYYYYMMDD`, `ToDateYYYYMMDD` (required). Optional integer `DocumentType` (`-1` = all) | `ResponseCode`, `Description` |
| `Documents/GetReport` | Search issued documents | `ApiName`, `ApiPassword`, `FromDateYYYYMMDD`, `ToDateYYYYMMDD` (required). Optional `AccountId` or `CusotmerName` (sic), integer `DocType` (`-1` all invoices, `-2` all documents, `-3` refunds only), `PageNumber`, `ItemsPerPage` (max 200) | `ResponseCode`, `Description`, documents |
| `Documents/CrossDocument` | Cross one document against a list of others (optionally a partial sum per target) | `ApiName`, `ApiPassword`, `FromDocNumber`, integer `FromDocType`, `ToDocumentsList[]` (`DocNumber`, `DocType`, `PartialSumToCorss`) | `ResponseCode`, `Description` |
| `Documents/CreateDocumentUrl` | Get the URL of an EXISTING document (it does not create one) | `ApiName`, `ApiPassword`, `DocumentNumber`, `DocumentType` (string enum, `Auto` not accepted) | `ResponseCode`, `Description`, `DocUrl` |
| `Documents/ExternalShopCreateDocument` | Create documents for deals made through an external shop platform | `TerminalNumber`, `ApiName`, `ApiPassword`, `Document`, `ExternalMerchantId`, `ExternalUniqueTranIds`, `OrderId`, `Platform` (all required) | `ResponseCode`, `Description` |

There is no dedicated `Documents/CreateTaxInvoice` endpoint in the V11 schema. To
issue a tax invoice, call `Documents/CreateDocument` with
`DocumentTypeToCreate: "TaxInvoice"` (or `"TaxInvoiceAndReceipt"`); see
document-types.md for the full enum.

## RecuringPayments

Note the path spelling: `RecuringPayments` (single `r`), as it appears in the
official V11 schema.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `RecuringPayments/GetRecurringPayment` | GET | Get recurring charge details |
| `RecuringPayments/GetRecurringPaymentHistory` | GET | Payment history for a recurring plan |
| `RecuringPayments/IsBankNumberValid` | GET | Validate an Israeli bank account |
| `RecuringPayments/GetMuhlafim` | POST | Replaced-card (muhlafim) data |
| `RecuringPayments/GetMuhlafimByDate` | POST | List replaced-card tokens by date |
| `RecuringPayments/GetMuhlafimFile` | POST | Download the replaced-card file |
| `RecuringPayments/ChangeStatusForHistoryRecurringToIrrevocable` | POST | Mark a recurring history entry irrevocable |

There is no `GetNewMuhlafim`, `UpdateMuhlafimDone`, or `SuspendedDealActivateOne`
endpoint in the V11 schema; do not invoke those.

## SuspendedDeals

| Endpoint | Required fields | Notes |
|----------|-----------------|-------|
| `SuspendedDeals/Charge` | `TerminalNumber`, `ApiName`, `SuspendedDealID` | Capital `ID` in requests; the `SuspendedInfo` result spells it `SuspendedDealId`. `additionalProperties: false` |
| `SuspendedDeals/Cancel` | `TerminalNumber`, `ApiName`, `SuspendedDealID` | Cancel a suspended deal you will not charge |
| `SuspendedDeals/GetSuspendedDealInfo` | `TerminalNumber`, `ApiName`, `SuspendedDealID` | |
| `SuspendedDeals/GetSuspendedDeals` | `TerminalNumber`, `ApiName` | List the terminal's suspended deals |
| `SuspendedDeals/UpdateSuspendedDealInfo` | `TerminalNumber`, `ApiName`, `SuspendedDeal` (object) | |

## Settlement cycles

Configured on the terminal, not via the API. Cardcom publishes three: monthly (transactions
from the 1st through the day before month-end are credited on the 6th of the following month),
weekly (Sunday through Friday, credited the Wednesday of the following week), and bi-monthly
(the 1st to the 15th credited on the 2nd of the following month; the 16th through the day
before month-end credited on the 8th). Confirm the merchant's actual cycle before promising a day.

## Financial

| Endpoint | Purpose |
|----------|---------|
| `Financial/CreditCardTransactions` | Credit card transaction report |
| `Financial/CreditCardTransactionsHalted` | Halted credit card transactions |
| `Financial/FinancialTransactions` | Financial transaction report |
| `Financial/BankDeposites` | Bank deposit records |
| `Financial/GetSlikaInvoices` | Billing report for the account ("Get billing report for account") |
| `Financial/GetMoneyTransfers` | Money transfer records |

## CompanyOperations

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `CompanyOperations/NewCompany` | POST | Register a new merchant |
| `CompanyOperations/GetCompanyStatus` | GET | Check merchant account status |
| `CompanyOperations/GetCompanyStatusV2` | GET | Merchant account status (v2) |
| `CompanyOperations/GetBanks` / `GetBanksBranches` / `GetCities` / `GetStreets` / `GetCountries` | GET | Reference data lookups |

## Common Parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `ISOCoinId` | int | `1` = ILS, `2` = USD, the rest follow the ISO currency list |
| `Language` | string | `he`, `en`, `ru`, `sp` (Low Profile page language) |
| `ReturnValue` | string | Your order id, returned unchanged in `GetLpResult`. The spec says you get it back at the webhook too, but the webhook is unauthenticated, so reconcile it from `GetLpResult` |
| `NumOfPayments` | int | Installment count (tashlumim); `1` = single charge |

## Alternative Payment Methods on Low Profile

| Method | Exposure on Low Profile | Where to enable |
|--------|------------------------|-----------------|
| Bit | `UrlToBit` field on `CreateLowProfileResponse` | Cardcom admin panel, terminal settings |
| PayPal | `UrlToPayPal` field on `CreateLowProfileResponse` | Cardcom admin panel, terminal settings |
| Apple Pay | wallet button inside the hosted page. Supported for redirect, charge-only and suspended deals; iframe only after domain registration with Apple via Cardcom support; NOT for token saving or standing orders | Terminal list > terminal menu > Apple Pay (terminal must be an internet EMV terminal) |
| Google Pay | button integrated in Low Profile pages once the terminal permission is enabled | Cardcom admin panel, terminal permissions |

Bit and PayPal have explicit URL fields you can render separately. Apple Pay and Google Pay are rendered inside the hosted Low Profile page itself once enabled on the terminal, so the API response does not expose dedicated URL fields for them.

## API Version

V11 is the current API as of 2026. There is no public V12. Legacy `.aspx` interfaces with integer document codes (e.g. `101`, `400`) and the `DealResponse` shape predate V11; do not use them in new integrations.

## API Docs

Official documentation: `https://secure.cardcom.solutions/Api/v11/Docs`
Support center: `https://support.cardcom.solutions`

## Allocation numbers (mispar haktzaa)

There is deliberately no allocation-number field on any document request or on `DocumentInfo`.
Do not go looking for one. (The only such field in the spec, `SlikaInvoicesResult.TaxAuthorityAllocationNumber`,
belongs to the result of `Financial/GetSlikaInvoices`, a billing report ("Get billing report for account"), not to a document you issue.) The number is printed on
the document PDF under "מספר הקצאה:". Cardcom holds a direct interface to the Tax Authority and requests the
number server-side when a tax invoice over the threshold is issued, provided the business
completed the Israel Invoices registration in SKILL.md Step 4.5 and its three-month
verification code is still valid. Absence of the field
is not a gap in the API.
