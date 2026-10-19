# Domain checklist r1: Cardcom REST API V11 integration skill

Researched 2026-10-12. Sources: the live OpenAPI spec `secure.cardcom.solutions/swagger/v11/swagger.json` (info.version `11.0`, server `https://secure.cardcom.solutions/`, local copy `src/swagger.json`), parsed with allOf/oneOf/$ref resolved. The Cardcom KB was pulled via the Zendesk Help Center API: 44 `he` articles in total, 0 under `en-us`. The VAT Law text comes from the Wikisource consolidated version (`src/vat.html`), cross-checked against gov.il and secondary sources. No live payment calls were made.

**Key structural finding:** the KB documents V11 in a single article, 27006768727698 ("ממשק Api JSON + SWAGGER"). Every other article describes the legacy API10 Name-to-Value / WebService interface (`/Interface/*.aspx`, `BillGoldService.asmx`). The skill therefore has to map KB rules (retries, token retention, J5, MTI 420, duplicate prevention, document codes) onto V11 field names, and say so wherever V11 has no equivalent.

**Second finding:** the V11 spec has **no allocation-number field** on any document request or on `DocumentInfo`. The only such field is `SlikaInvoicesResult.TaxAuthorityAllocationNumber` on the `Financial/GetSlikaInvoices` billing report (verified 2026-10-12). The legacy `CreateInvoice.aspx` response carries `TaxAuthorityAllocationNumber` (KB 26955728611602, row 5, described there as "rare, only for merchants not using our bookkeeping transfer").

---

## Must cover (core)

### A. Authentication and credentials, per endpoint

V11 uses no HTTP auth scheme: `components.securitySchemes` is null. Credentials travel in the JSON body, and the required set differs by endpoint. Each row below is taken from the resolved request schema (`*` = required).

| # | Endpoint | TerminalNumber | ApiName | ApiPassword | Source |
|---|---|---|---|---|---|
| A1 | `POST /api/v11/LowProfile/Create` | required | required | not a field. Only `AdvancedDefinition.ApiPassword`, "Required only if IsRefundDeal is true" | schema `CreateLowProfile`, `AdvancedLPDefinition` |
| A2 | `POST /api/v11/LowProfile/GetLpResult` | required | required | none | `GetLowProfileResult` |
| A3 | `POST /api/v11/Transactions/Transaction` (charge) | required | required | none | `TransactionReq` |
| A4 | `POST /api/v11/Transactions/Transaction` with `Advanced.IsRefund=true` | required | required | `Advanced.ApiPassword` required ("Required only if 'IsRefund' is true") | `AdvancedTran` |
| A5 | `POST /api/v11/Transactions/RefundByTransactionId` | **no TerminalNumber field** | required | **required** | `RefundByTransactionIdReq` |
| A6 | `POST /api/v11/Transactions/GetTransactionByExternalUniqTran` | required | required | none | `GetExternalUniqTranIdStatusReq` |
| A7 | `POST /api/v11/Transactions/GetTransactionInfoById` | required | named **`UserName`** (not ApiName), required | named **`UserPassword`**, required | `TransactionInfoRequest` |
| A8 | `POST /api/v11/Transactions/ListTransactions` | none (optional `LimitForTerminal`) | required | required | `ListTransactionsReq` |
| A9 | `POST /api/v11/Documents/CreateDocument` | none | required | required | `CreateDocumentRequest` |
| A10 | `POST /api/v11/Documents/CancelDoc` | none | required | required | `CancelDocRequest` |
| A11 | `POST /api/v11/Documents/CreateDocumentUrl` | none | required | required | `GetDocumentRequest` |
| A12 | `POST /api/v11/Documents/GetReport` | none | required | required | `DocumentSearchRequest` |
| A13 | `POST /api/v11/SuspendedDeals/{GetSuspendedDealInfo,Charge,Cancel,UpdateSuspendedDealInfo}` | required | required | none | `SuspendedDeals*Request` |

- A14. **Key rule.** Company-wide reads and writes (reports, standalone documents, `CancelDoc`, `RefundByTransactionId`) require `ApiPassword`; single-card operations (`LowProfile/Create`, `Transactions/Transaction`, `SuspendedDeals/*`) do not, even when they create a document, except the nested `Advanced.ApiPassword` / `AdvancedDefinition.ApiPassword` required for `IsRefund` / `IsRefundDeal`. `ApiName` plus a stored token can already charge a card, so ALL credentials are secrets.
- A15. The test terminal is `TerminalNumber=1000`, and its API username must be requested from Cardcom support. The terminal runs the full clearing flow to the card companies but never debits the card (KB 27008168721426).

### B. Low Profile hosted page (iframe or redirect)

- B1. `LowProfile/Create` required fields: `TerminalNumber`, `ApiName`, `Amount` (decimal), `SuccessRedirectUrl` (max 500), `FailedRedirectUrl` (max 500), `WebHookUrl` (max 500). Optional: `CancelRedirectUrl`, `ReturnValue` (max 250, "usually send your unique order Id, you will get it back in the WebHook"), `ProductName`, `Language` (he/en/ru/sp, default he), `ISOCoinId` (1=ILS, 2=USD, otherwise ISO 4217) or `AdvancedDefinition.ISOCoinName`. Schema `CreateLowProfile`.
- B2. Response `CreateLowProfileResponse`: `ResponseCode` (0 = success), `LowProfileId` (guid, "save it in your data base!"), `Url` (redirect target or iframe src), `UrlToPayPal`, `UrlToBit`.
- B3. The `Operation` enum, each with its own result block in `LowProfileResult`:

| Operation | What it does | Non-null result block | Source |
|---|---|---|---|
| `ChargeOnly` (default) | One-time charge | `TranzactionInfo` | `Operation` enum; `LowProfileResult.TranzactionInfo` description |
| `ChargeAndCreateToken` | Charge and store a token for later charges | `TranzactionInfo` + `TokenInfo` | `LowProfileResult.TokenInfo` description |
| `CreateTokenOnly` | No charge. Validates per `AdvancedDefinition.JValidateType` (J2 or J5, **default 5**) and returns a token | `TokenInfo` | `AdvancedLPDefinition.JValidateType` |
| `SuspendedDeal` | Stores a suspended deal for later charge | `SuspendedInfo.SuspendedDealId` | `SuspendedInfo` |
| `Do3DSAndSubmit` | 3-D Secure flow (pair with `AdvancedDefinition.ThreeDSecureState` = `Auto`/`Enabled`/`Disabled`) | per flow | `Operation`, `ThreeDSecureState` enums |

- B4. Installments: `AdvancedDefinition.MinNumOfPayments` / `MaxNumOfPayments` (1-36), `SelectedNumOfPayments`, `FirstPayment`, `ConstPayment`, `CreditType` (Israeli cards only; 6 = Israeli credit for multiple payments). Installments and credit work only on Israeli cards: the tourist test card "does not support payments and credit" (KB 27008168721426).
- B5. UI prefill and requirement flags (`UIDefinition`): `CardOwnerNameValue`, `CardOwnerIdValue` (teudat zehut), `CardOwnerEmailValue`, `CardOwnerPhoneValue`, the `IsHide*` / `Is*Required` flags, `IsHideCVV`, and `CSSUrl`, which requires Cardcom permission.
- B6. Page lifetime: the LP page times out 20 minutes after the cardholder opens it, and an LP code expires 24 hours after creation (KB 27007108827922). V11 has no revoke endpoint. Revoking early is legacy-only (a legacy `.aspx` interface, same KB), so mark it as such.
- B7. Iframe rules: the redirect URLs must be https and externally reachable, never localhost (KB 26955864890130, rows 14-15).
- B8. Never treat the success redirect as proof of payment. The cardholder can close the page before the redirect fires, so fulfil orders from the webhook or `GetLpResult` only (KB 26955864890130, IndicatorUrl notes item 3).

### C. Webhook (WebHookUrl) and result verification

- C1. Cardcom calls `WebHookUrl` server-to-server **before** redirecting the cardholder (KB 26955864890130, IndicatorUrl row 15, legacy name for the same mechanism). `GetLpResult` is "not mandatory, you can use WebHookUrl" (KB 27006768727698).
- C2. Retry contract: the endpoint must return **HTTP 200**. Otherwise Cardcom re-sends up to **7 times**, at intervals of 1 min, 2, 2, 16, 60 min, 12 h, 12 h (KB 26955864890130, item 5). The skill must cover idempotent handling of repeated deliveries.
- C3. The spec defines no payload signature or HMAC. KB 26955864890130 says that after receiving the data you must query the Cardcom server to verify it (step 2). So the skill must make the handler call `LowProfile/GetLpResult` with the received `LowProfileId`, and trust only that response. It also needs to match `ReturnValue` and `Amount` against the stored order.
- C4. Allow Cardcom's source IP ranges if you firewall the endpoint: `82.80.227.17/29` and `82.80.222.124/29`, on ports 80, 8080 and 443 (KB 28449298672402, documented for document webhooks; the same Cardcom servers send LP reports).
- C5. Mark an order "pulled" so that page refreshes and crawlers revisiting the success page cannot produce duplicate orders (KB 26955864890130, step 2).
- C6. Success semantics: `LowProfileResult.ResponseCode==0` means only that the API call succeeded. Payment success is `TranzactionInfo.ResponseCode`: **0 for a charge, 701 for J2, 700 for J5** (schema `TransactionInfo.ResponseCode` says only "700 and 701 success for J2 and J5"; the pairing is from KB 26960213410578: "בדיקה J2 (קוד 701), ואישור J5 (קוד 700)"). In legacy terms, check `OperationResponse==0` and not the top-level code (KB 26955864890130). Bit, PayPal and wallet payments are also judged on the operation result.
- C7. Persist these fields from `LowProfileResult`: `LowProfileId`, `TranzactionId`, `ReturnValue`, `TokenInfo.{Token, TokenExDate (yyyyMMdd), CardYear, CardMonth, TokenApprovalNumber, CardOwnerIdentityNumber}`, `DocumentInfo.{DocumentType, DocumentNumber, DocumentUrl, AccountId}`, `TranzactionInfo.{ApprovalNumber, Last4CardDigitsString, Uid, IsAbroadCard}`. TokenInfo's own description reads: "You need to save all of the information in the database next to the account."

### D. Server-to-server token charges (recurring billing)

- D1. `Transactions/Transaction` with `Token` (guid) + `CardExpirationMMYY` + `Amount`. Spec example: "Charge Token".
- D2. Token charging requires a terminal **without a CVV obligation**. Such a terminal does not check CVV and only requires a future expiry date. Ask Cardcom whether the business has a separate no-CVV terminal (KB 26960101857298, lines 8-9, 31).
- D3. Idempotency: `ExternalUniqTranId` blocks a repeat charge with the same ID (error **608**). `ExternalUniqUniqTranIdResponse=true` returns the original transaction instead of the error (schema `TransactionReq`). In legacy terms this is `TokenToCharge.UniqAsmachta` (max 25 chars) (KB 26960213410578, 26960101857298 row 27).
- D4. Timeout recovery: on T/O, query `GetTransactionByExternalUniqTran` before retrying. Do not send parallel requests with the same ID. Approval normally takes about 1 second and can take up to 7 seconds (KB 26960101857298, row 27).
- D5. `Advanced.IsAutoRecurringPayment=true` **only** when the terminal is registered with the card companies and SHVA as a standing-order (הו"ק) terminal. Do not set it on a telephone or regular no-CVV terminal (KB 26960101857298, row 29).
- D6. Token retention: with the tokens or standing-order module, Cardcom keeps a token until the card expires. Without it, only **6 months**, for refunds only (KB 26955864890130, closing note; KB 26960101857298). If a card expires within the last 3 months before a charge, Cardcom extends the validity by 6 months automatically (KB 26960101857298, row on `CardValidityYear`).
- D7. Installments on a token charge: `NumOfPayments` (1-36), `Advanced.FirstPayment` + `Advanced.ConstPayment`. Invariant: Amount = FirstPayment + ConstPayment x (NumOfPayments - 1) (KB 26960101857298 note; the KB formula is written as "ConstPayment*(NumOfPayments)" and must be checked against a test charge before publishing).
- D8. Charging a raw card server-side (`CardNumber` + `CardExpirationMMYY` + `CVV2`) is possible but changes the PCI scope (see G2).
- D9. `Advanced.AccountIdToGetCardNumber` charges a card stored on a Cardcom account. Documents still need `Document.AdvancedDefinition.AccountID` + `IsLoadInfoFromAccountID=true` (schema `AdvancedTran`).

### E. J2 / J5 validation and capture

| # | Variant | V11 fields | Success code | Source |
|---|---|---|---|---|
| E1 | **J2**: checks the card is valid only, holds no funds | `JValidateType=2` (LP `AdvancedDefinition.JValidateType`, or `Advanced.JValidateType` on Transaction) | 701 (KB 26960213410578) | enum `JValidateType [2,5]`; KB 26955864890130 lines 308-327 |
| E2 | **J5**: authorization that holds the amount, with a one-time approval code | `JValidateType=5` | 700 (KB 26960213410578) | same. "Use of J5 is subject to card-company approval." The hold lasts 3 days to a week (KB 26955864890130), "3 days to two weeks, sometimes a month" (KB 26984210838034) |
| E3 | **Capture after J5** | `Transactions/Transaction` with `Token` + `Advanced.ApprovalNumber` = the J5 approval (spec example "Charge Token After Capture") | 0 | `AdvancedTran.ApprovalNumber` ("capture an J5 (authoriz) request"). An approval number can be used **once** only (KB 26960101857298, row ApprovalNumber) |
| E4 | **Release a J5 hold early** | `Advanced.MTI=420` + `Advanced.ApprovalNumber` (in legacy, the Cardcom deal number of the hold) | 0 | `AdvancedTran.MTI`; KB 26984210838034 |
| E5 | **Test limitation** | The test terminal 1000 **cannot** run J5, so it cannot release one either. Test on a real terminal with a minimal amount | n/a | KB 26984210838034 |

- E6. `CreateTokenOnly` defaults to J5 (`default=5`). The skill must say so, because a J5 places a real hold on a real card.

### F. Refunds and cancellations

| # | Variant | Endpoint / fields | Notes | Source |
|---|---|---|---|---|
| F1 | Refund by transaction ID, full or partial, **no document** | `RefundByTransactionId`: `TransactionId`*, `PartialSum`, `AllowMultipleRefunds`, returns `NewTranzactionId` | ApiName + ApiPassword, no TerminalNumber | schema; KB 27006768727698 ("full/partial cancellation of a deal only, without a document") |
| F2 | Cancel before deposit (void) | `RefundByTransactionId` with `CancelOnly=true` | Only before the transaction is deposited to the acquirer | schema `CancelOnly` description |
| F3 | Cancel the document **and** refund the card | `Documents/CancelDoc`: `DocumentNumber`*, `DocumentType`* (**integer** code, see H), `IsCancelEmailSend`, `IsSendSMS`, `IsCreditCardCancelOnly` | Returns `NewDocumentNumber` / `NewDocumentType` (the credit document) | schema `CancelDocRequest` / `CancelDocResponse` |
| F4 | Token refund (credit to a stored card) | `Transactions/Transaction` with `Token` + `Advanced.IsRefund=true` + `Advanced.ApiPassword` | A refund needs no ApprovalNumber (KB 26960101857298, line 106) | `AdvancedTran` |
| F5 | Refund via a hosted page | `LowProfile/Create` with `AdvancedDefinition.IsRefundDeal=true` + `ApiPassword` | | `AdvancedLPDefinition` |
| F6 | **Time limit** | A deal can be cancelled within **6 months**. Later refunds need the token module | | KB 26985420312082; KB 26955864890130 closing note |
| F7 | Refund documents | A refund through F1 creates no accounting document. A refund that needs a credit document must use F3, or F4 with `Document.DocumentTypeToCreate = *Refund` | | KB 27006768727698 vs schema `DocumentTran` |

### G. PCI DSS scope, one row per integration pattern

| # | Pattern | PAN reaches merchant server? | Likely SAQ | Source |
|---|---|---|---|---|
| G1 | LP **redirect** (`Url` as full-page redirect) | No | SAQ A. The script-security eligibility criterion does not apply to redirects | PCI DSS v4.0.1 SAQ A + PCI SSC FAQ 1588 (Feb 2025) |
| G2 | LP **iframe** | No | SAQ A, **plus** the eligibility criterion that the merchant page is "not susceptible to attacks from scripts". Practically that means 6.4.3 / 11.6.1-style controls or a TPSP confirmation | FAQ 1588; KB 27006768727698 calls the LP "a secure page in the PCI standard" |
| G3 | `Transactions/Transaction` with `CardNumber`/`CVV2`, or LP `AdvancedDefinition.CardNumber`/`CVV` | **Yes** | SAQ D (merchant). The skill must warn and steer to G1 or G2 | schema `TransactionReq`, `AdvancedLPDefinition` |
| G4 | Token-only charges (`Token` guid) | No PAN stored | Stays at the scope of how the token was obtained. The token is a credential: store it encrypted and access-controlled | schema `TokenInfo` |

- G5. Never log `CardNumber`, `CVV2`/`CVV` or the full request body of Transaction calls. Log only `Last4CardDigitsString`.

### H. Tax documents: `Document.DocumentTypeToCreate` variants

The request enum is `DocumentToCreate` (25 values, string). The response enum is `DocumentType`. `CancelDoc.DocumentType` is an **integer**, so the numeric codes from KB 26955728611602 (InvoiceType table) are needed. The enum-name-to-number pairing below is inferred from the Hebrew labels and **must be verified on the test terminal**.

| # | Enum value | KB code / Hebrew | Who may issue / when | Source |
|---|---|---|---|---|
| H1 | `Auto` (default) | Takes the type configured in the admin panel | Safe default. Do not rely on it for a B2B invoice above the allocation threshold | `DocumentBase.DocumentTypeToCreate` default |
| H2 | `TaxInvoiceAndReceipt` | 1, חשבונית מס קבלה | עוסק מורשה, sale paid at once (the normal e-commerce case) | KB 26955728611602 |
| H3 | `TaxInvoiceAndReceiptRefund` | 2, חשבונית מס קבלה זיכוי | Credit for H2 | same |
| H4 | `Receipt` | 3, קבלה מלכ"ר / פטור מע"מ | עוסק פטור or nonprofit. These **cannot** issue a tax invoice (VAT Law s.47(א): only עוסק מורשה) | KB + VAT Law s.47(א) |
| H5 | `ReceiptRefund` | 4 | Credit for H4 | KB |
| H6 | `TaxInvoice` | 305 | Invoice before payment | KB |
| H7 | `TaxInvoiceRefund` | 330, חשבונית זיכוי | Credit for H6 | KB |
| H8 | `ReceiptForTaxInvoice` | 400, קבלה לחשבונית | Payment against an open H6 | KB |
| H9 | `ReceiptForTaxInvoiceRefund` | 410 | | KB |
| H10 | `DonationReceipt` / `DonationReceiptRefund` | 405 / 406 | Donation receipt (s.46 institutions) | KB |
| H11 | `Order`/`OrderConfirmation`/`OrderConfirmationRefund` | 100 / 101 / 102, internal document, not passed to bookkeeping | Non-fiscal | KB |
| H12 | `Quote`, `DeliveryNote`(+Refund), `ProformaInvoice`, `DemandForPayment`(+Refund) | 50, 200/210, 300 (חשבון עסקה), 301/302 | Non-tax documents | KB |
| H13 | `CouponDocumentAndReceipt`(+Refund) / `Products[].IsGiftCard` | Gift-card lines "create a non financial document type" | | schema `Products.IsGiftCard` |

Document fields the skill must cover (schema `DocumentBase`, `DocumentTran`, `DocumentLP`, `Products`):

- H14. `Name`* (recipient, max 50), `TaxId` (business number or ID number, max 50), `Email`, `IsSendByEmail` (default true), `Products[]` with `Description`* (max 250), `UnitCost`*, `Quantity`, `TotalLineCost` ("recommended if Quantity has decimals, to prevent rounding errors"), per-line `IsVatFree`, document-level `IsVatFree`, `Comments`, `ExternalId`, `DepartmentId`. Also `Language` (LP) / `Languge` (sic, Transaction and CreateDocument).
- H15. **The document total must equal the transaction amount exactly.** A discount line may be negative, but the totals must still match. Round to 2 decimals (KB 26955677133074, notes after line 175).
- H16. LP-only flags: `IsShowOnlyDocument=true` shows document lines to the cardholder but **creates no document**. `IsAllowEditDocument` lets the cardholder edit the recipient details, but not the products or amount (`DocumentLP`).
- H17. VAT: the default is the standard rate. `IsVatFree` at document level means zero-rate VAT ("suitable for a foreign customer"); KB 26955728611602 rows say "true = מע"מ 0, False = מע"מ 18". **The V11 `Products` schema has no `IsPriceIncludeVat`**. Only the recurring and suspended-deal schemas have it. The skill must state that VAT-inclusive vs. exclusive line semantics in V11 have to be verified on the test terminal.
- H18. Customer accounts: `AdvancedDefinition.IsAutoCreateUpdateAccount` (`auto`/`true`/`false`), `AccountForeignKey` (for Hashavshevet or SAP export), `SiteUniqueId`, `AccountID`, `IsLoadInfoFromAccountID`. Lookup order when absent: foreign key, then site unique ID, then email (`AdvancedDocumentDefinition` description).
- H19. Standalone documents: `Documents/CreateDocument` (`Document`* + `Cash`, `Cheques[]`, `CustomFields[]` (other payments), `DealNumbers[]` to attach to existing card deals). Retrieval: `Documents/CreateDocumentUrl` (`DocumentType` cannot be `Auto`) returns `DocUrl`. Search: `Documents/GetReport` (`DocType` -1 = all invoices, -2 = all documents, -3 = refunds only; `ItemsPerPage` max 200).
- H20. Document-created webhook: configured in the admin UI (Settings > 3. Documents > 4. Document settings in interfaces), not per request. It POSTs `BillGoldCompID`, `DocType`, `DocNumber`, `ExternalCompID` and `ResponseCode` to the merchant URL. It needs HTTP 200, retries 7 times in 24 h, then expects you to pull the details (KB 28449298672402).

### I. Israel Invoice model (allocation numbers)

- I1. Statutory basis: VAT Law s.38(א1). Input VAT on a tax invoice whose pre-VAT amount exceeds **5,000 ILS** (Jan-May 2026: **10,000 ILS**; effective 1 June 2026) cannot be deducted unless the invoice carries an allocation number issued under s.47(א2)(2), s.47(א3)(1) or s.47(א4). Sources: VAT Law consolidated text; gov.il service "בקשה למספר הקצאה לחשבונית מס" ("over 5,000 ILS, updated for 2026"). Older schedules (25k/20k/15k/10k/5k-by-2028) are superseded and must not be cited.
- I2. s.47(א2)(1): an עוסק מורשה **must** request a number when the buyer demands one and the pre-VAT amount exceeds the s.38(א1) threshold. The rule **does not apply to zero-rated transactions**. The request is made online (s.47(א2)(2)). A number can also be requested after the invoice is issued (s.47(א2)(4)).
- I3. Refusal path: s.47(א2)(3) provides a preliminary refusal, a hearing within 2 business days, and the buyer's option to self-assess (reverse charge, s.47(א3)). Mention it only. The skill should not walk through it.
- I4. It matters only for **B2B** tax invoices (`TaxInvoiceAndReceipt`, `TaxInvoice`) to a buyer who is a registered business. s.47(ב)(1) requires the tax invoice to show the buyer's registration number, so `Document.TaxId` must carry the buyer's ע.מ./ח.פ. on B2B sales.
- I5. **No allocation-number field on V11 document requests or on `DocumentInfo`.** Resolved 2026-10-12 from Cardcom's own guides (support KB 27351210830738, 19522038057362): Cardcom requests the number automatically while its Israel Invoices registration (a three-month verification code) is active, and prints it on the document under "מספר הקצאה:", so read it from the PDF (`DocumentUrl`). `SlikaInvoicesResult.TaxAuthorityAllocationNumber` belongs to the `Financial/GetSlikaInvoices` billing report, not to documents you issue.
- I6. Buyer-side check: the gov.il service "אימות פרטי חשבונית הספק על סמך מספר הקצאה" verifies a supplier invoice by its allocation number.

### J. Error handling and environment

- J1. Two error layers: an HTTP 400/401 with an `ErrorInfo {ResponseCode, Description}` body, and an HTTP 200 with a non-zero `ResponseCode`. Both must be handled, and `Description` must be logged and alerted on (KB 26955864890130, response row 2).
- J2. Specific codes: **608** (duplicate `ExternalUniqTranId`), **700/701** (J2/J5 success, not an error).
- J3. Test cards (KB 27008168721426): Israeli card `4580280000000008` (supports installments and credit), tourist card `4580000000000000` (does not), any future expiry, CVV `123`, any ID number. On the test card, amounts **under 5,000 ILS succeed and amounts over 5,000 ILS fail**. A real card on the test terminal is not charged, but its credit line is held for 3 days.
- J4. Spec quirks the skill must warn about:
  - Spec examples put `JValidateType` at the top level of `TransactionReq`, but the schema places it under `Advanced`.
  - The LP example "Charge and Create Doc" uses `Document.To`, but the schema requires `Document.Name`.
  - `GetTransactionInfoById` uses `UserName`/`UserPassword`.
  - The `RecuringPayments` GET endpoints declare a JSON body with lowercase `apiUserName`/`apiPassword`.

---

## Should cover (advanced)

- S1. **Suspended deals lifecycle:** `SuspendedDeals/GetSuspendedDeals`, `GetSuspendedDealInfo` (`SuspendedDealID`*, returns `SumToBill`, `Token`, `ApprovalNumber`, `HasInvoice`, `Invoice.Items[].IsPriceIncludeVat`), `UpdateSuspendedDealInfo`, `Charge` (returns `DealNumber` + `InvoiceInfo.{InvoiceNumber,InvoiceType}`), `Cancel`. A suspended deal is a one-time hold; KB 26960944471058 says "for more flexibility, use the token module instead".
- S2. **Replaced-card (מוחלפים) updates for standing-order terminals:** `RecuringPayments/GetMuhlafimByDate`, `GetMuhlafim`, `GetMuhlafimFile`. Only relevant with `IsAutoRecurringPayment` terminals, which receive the card companies' replaced-card file (KB 26960101857298, row 29).
- S3. **Cardcom-managed recurring module (read-only in V11):** `GetRecurringPayment` (`RecurringId`, `NextDateToBill`, `ChargeIntervals`, `DocTypeToCreate`, `FlexItem.IsPriceIncludeVat`) and `GetRecurringPaymentHistory`. Contrast with merchant-scheduled token charges. V11 has no create endpoint for these.
- S4. **3-D Secure:** `Operation=Do3DSAndSubmit`, `ThreeDSecureState`, `AdvancedDefinition.Token`/`CardNumber`/`CVV` for 3DS-then-charge.
- S5. **Reconciliation:** `Transactions/ListTransactions` (`FromDate`/`ToDate` DDMMYYYY, `TranStatus` Success/All/Failure, `Page_size` 10-2000) and `Transactions/SpecialTransactions` (chargebacks and other special entries, only when Cardcom is the acquirer: `SpecialType`, `ARN`, `UID`).
- S6. `TranzactionInfo.Uid` is shared between an original transaction and its refunds/cancellations. Use it to link them.
- S7. **AVS:** `IsAVSEnable` (LP) and `CardOwnerInformation.AvsZip/AvsAddress/AvsCity` (Transaction). These work on EMV terminals only (terminals opened from 9/2017; KB 26960101857298 rows 30-32).
- S8. **Alternative methods on the LP:** `UrlToBit` and `UrlToPayPal` for direct buttons. They require terminal setup first (KB 26955864890130, response rows 5-6). Judge success on the operation result (C6).
- S9. **Custom fields:** `CustomFields[]` with Id 1-25 and Value of max 50 chars. They are stored on the deal and appear in reports (KB 26955864890130).
- S10. **UTM passthrough:** `UTM.{Source,Medium,Campaign,Content,Term}` is returned in the result.
- S11. **Aggregator (מאגד) terminals:** `SapakMutav` (max 15) on LP, Transaction and Refund (override). Flag it only.
- S12. **Token migration from another PSP** is legacy only (a legacy `.aspx` interface, KB 27007876539154). There is no V11 equivalent; flag it.
- S13. **Client generation:** the KB recommends generating a client from the OpenAPI v3 file (NSwag, OpenAPI Generator) or importing it into Postman (KB 27006768727698).
- S14. `Documents/SendAllDocumentsToEmail` (date-range PDF dump) and `Documents/CrossDocument` (linking documents) are secondary document operations.

---

## Out of scope (explicit)

- O1. `CompanyOperations/*` (merchant and sub-merchant onboarding, KYC, Meaged company creation, cities, banks and MCC lookups).
- O2. `Financial/*` (digital bank, money transfers, deposits, Cardcom billing reports, future bank-transfer estimates).
- O3. `TapTransactions/*` (Tap on Phone SoftPOS SDK).
- O4. Bank direct debit (הוראת קבע בנקאית; KB 27008148287634, 27008872570514), `IsBankNumberValid`, and `ChangeStatusForHistoryRecurringToIrrevocable`.
- O5. CMS plugins (WooCommerce, KB 27008777793298), Google Pay merchant configuration (KB 27009036176274), and LP CSS/HTML page design (KB 26982768739986).
- O6. Building new integrations on legacy API10 Name-to-Value / WebService (`/Interface/*.aspx`, `BillGoldService.asmx`). Reference these only where V11 has no equivalent (S12, B6).
- O7. Tax or accounting advice: choosing עוסק מורשה vs. פטור status, VAT reporting, bookkeeping export. The skill states the document-type rules (H) and the allocation thresholds (I), then refers the user to an accountant. A legal-review notice is likely needed: the skill names tax document types and VAT thresholds.
- O8. Requesting allocation numbers directly from the Tax Authority's API (SHAAM). That is the invoicing software's job, not part of a Cardcom integration.
- O9. Live payment calls, real-card testing advice beyond J3, and chargeback dispute handling.
- O10. Full PCI DSS assessment guidance beyond the SAQ-type mapping in G.

---

## Authoritative sources

| Source | Use |
|---|---|
| Cardcom V11 OpenAPI: https://secure.cardcom.solutions/swagger/v11/swagger.json (local `src/swagger.json`, fetched 2026-10-12); UI at https://secure.cardcom.solutions/Api/v11/Docs | All field names, enums, required flags (A-H) |
| KB 27006768727698 ממשק Api JSON + SWAGGER | The only V11-specific article: endpoint purposes, GetLpResult optional |
| KB 26955864890130 ממשק פרופיל נמוך [שלב 1+2] (updated 2026-10-12) | Webhook retries, verify-after-webhook, OperationResponse, J2/J5, token retention |
| KB 26960101857298 חיוב/זיכוי אסימון [שלב 3] | No-CVV terminal, UniqAsmachta, IsAutoRecurringPayment, MTI, refund password, installments |
| KB 26960213410578 מניעת עסקאות כפולות | Duplicate prevention |
| KB 26984210838034 שיחרור מסגרת MTI=420 | J5 release; test terminal cannot run J5 |
| KB 26985420312082 ביטול עסקה קיימת | 6-month cancel limit |
| KB 27007108827922 ביטול קוד פרופיל נמוך | 20 min / 24 h LP expiry |
| KB 26960944471058 / 27008809186578 עסקה מושהית | Suspended deals |
| KB 26955728611602 יצירת חשבוניות NAME TO VALUE | Numeric InvoiceType codes, VAT 0/18, TaxAuthorityAllocationNumber (legacy) |
| KB 26955677133074 יצירת מסמך לעסקת אשראי | Document total = deal amount, line rules |
| KB 28449298672402 WEBHOOK, Invoice | Document webhook, retries, Cardcom IP ranges |
| KB 27008168721426 מידע לביצוע טסטים | Test terminal and cards |
| KB 27007876539154 יצירת אסימון מפרטי אשראי | Legacy token migration |
| חוק מס ערך מוסף, תשל"ו-1975, ss.38(א), 38(א1), 47(א), 47(א2)-(א4), 47(ב)(1), 47א (consolidated text, Wikisource, local `src/vat.html`) | Allocation threshold, who may issue a tax invoice, buyer registration number |
| gov.il: https://www.gov.il/he/service/request-assignment-number-for-tax-invoice ("over 5,000 ILS, updated for 2026"; returned 403 to the fetcher, text via search snippet) and the ITA vendor-invoice verification service | Allocation request and verification services |
| PCI DSS v4.0.1 SAQ A, and PCI SSC FAQ 1588 (Feb 2025, SAQ A eligibility replacing 6.4.3/11.6.1) | PCI scope per pattern (G). The FAQ was read via secondary summaries only; fetch the original before publishing |

### Open items (status 2026-10-12)

1. RESOLVED: allocation numbers are requested automatically while the Israel Invoices registration is active and are printed on the document (see I5).
2. Partly resolved: KB 26955677133074 requires the document lines to total exactly the charged amount, so line prices are entered as the gross amounts paid. Whether `UnitCost` alone is VAT-inclusive on a standalone `CreateDocument` without a charge is not documented.
3. Verify the enum-name to numeric `DocumentType` mapping needed for `CancelDoc`.
4. Get the exact V11 webhook payload shape (presumably the `LowProfileResult` JSON, which is undocumented in the KB). Its HTTP method and content type are also undocumented.
5. Check the installment formula: KB `First + Const*N` vs. `First + Const*(N-1)`.
6. Fetch PCI SSC FAQ 1588 directly.
7. Kol Zchut has no page on allocation numbers. The search found none, so the statute and gov.il are the primary sources.
