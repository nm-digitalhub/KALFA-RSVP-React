# Design

## Context

See proposal.md (Why). What the design rests on, each read on 18.10.2026:

- **CardCom's live OpenAPI** (`swagger/v11/swagger.json`):
  - `RefundByTransactionIdReq` has `ApiName`, `ApiPassword`, `TransactionId`, `PartialSum`, `CancelOnly`, `AllowMultipleRefunds`, `SapakMutav`, `CustomFields`, `ExternalDealId`, `ExternalRefundDealId`, `ExternalCaptureDealId` and `ExternalMerchantId`.
  - `RefundByTransactionIdResp` has `ResponseCode`, `Description` and `NewTranzactionId`.
  - No document field appears in either.
  - `CreateDocumentRequest` (`Documents/CreateDocument`) has `ApiName`, `ApiPassword`, `Document`, `Cash`, `Cheques`, `CustomFields`, `DealNumbers` (`RciExtDealNum[]`, each `{ DealNumber }`) and `IsSendSMS`. Its answer, `DocumentInfo`, has `ResponseCode`, `Description`, `DocumentType`, `DocumentNumber`, `AccountId` and `DocumentUrl`.
- **CardCom's support, through the owner (18.10.2026):** the same `Document` object as `Transactions/Transaction` (`DocumentTran`) makes this operation issue a credit document. **Disproved** by the first real refund (Verified facts).
- **The four real ₪1 payments on terminal 172204** each have a CardCom transaction id, a cardholder name, a `Receipt` document type and the live terminal. Three are not refunded yet.

## Goals / Non-Goals

**Goals:** the refund is linked to the payment's transaction, a credit document linked to the refund is issued, and the record says plainly whether the document was confirmed.

**Non-Goals:**
- `Documents/CancelDoc`, which answered 9006 on 9.10.2026;
- changing the admin cancellation flow or the "no card" text shared with SUMIT;
- SUMIT.

## Decisions

**D1. The request types are the generated models:** `RefundByTransactionIdReq` for the money and `CreateDocumentRequest` for the credit document. No shape is written by hand. (The first version added `Document: DocumentTran` to the refund, from CardCom's support. It was removed after the first real refund.)

**D2. When the extra fields are sent:**
- `PartialSum` only when the amount is less than the payment in whole agorot. With no partial sum, CardCom refunds the whole transaction, which equals the amount.
- `AllowMultipleRefunds: true` only when an earlier refund row of the campaign exists that did not fail. A refund still in review may already have moved money.
- `ExternalRefundDealId` is our refund row's id, for tracing in CardCom's reports. CardCom documents no deduplication by it, and this code never retries an unclear refund, so none is relied on.

**D3. The answer:**
- Code 0 with a positive whole `NewTranzactionId` is succeeded. Code 0 without one goes to review.
- `ApprovalNumber`, `TerminalNumber`, `CreateDate` and card details are not in the documented answer. They are read from the raw answer as unknowns, through the existing field mappers, so whatever CardCom returns is kept.
- The credit document comes from the `CreateDocument` answer (D6). Its link is kept only through `documentUrlFromCardcom`.

**D4. A credit document that is not confirmed does not send the refund to review.** The old `Transactions/Transaction` flow did send it to review. Here the money is confirmed by code 0 and the refund transaction id, and review would say the money may not be back, which would be false. So the row is succeeded, its note says why the credit document was not confirmed (with CardCom's code and text), and the alert is a warning, with CardCom's code only, to check it and issue it in CardCom if missing.
- **Never a second `CreateDocument`.** An unclear answer (a timeout, a 5xx) may hide a document that exists, and a second call could issue the tax document twice. A person checks CardCom's panel instead.

**D5. What a refund needs:** the payment's transaction id (`provider_payment_id`, a positive integer) and the cardholder name, which the document's `Name` requires. Lacking either is the existing `no_card` refusal. The token and expiry are not read anymore. The terminal check stays, because this request names no terminal and the API name decides it.

**D6. The credit document is issued by `Documents/CreateDocument`, after the refund, linked to it.** Built after the first real refund showed that the refund issues none (task 4.1; the owner, 18.10.2026: "לא הפיקה").
- It is sent only after the refund is confirmed (code 0 and `NewTranzactionId`), never after a refusal or a review.
- `DealNumbers: [{ DealNumber: NewTranzactionId }]` links it to the refund's own deal, not to the original charge.
- `Document`: the credit counterpart of the payment's document (`document-types.ts`), to the cardholder recorded on the payment (`Name`, `Email` when known, each cut to 50), `Languge: 'he'`, `ISOCoinID: 1`, one line for the amount that went back.
- Confirmed = `ResponseCode` 0, a positive whole `DocumentNumber`, and `DocumentType` equal to the type asked for. Anything else is D4.
- The type CardCom answers is kept in `meta.cardcom_document_type`, as before, so the ledger's `provider_document_type` and the document report read it.

## Risks / Trade-offs

- **`CreateDocument` with `DealNumbers` may not show the link in CardCom's panel as expected.** → The first real refund after this change (task 5.4) checks it in the panel.
- **A failed document call leaves a refund without a document.** → The note and warning say so, and staff issue it in CardCom. The code never retries it (D4).
- **The document call sits between the confirmed refund and its record** (up to 30 seconds). If the process stops there, the row stays pending without the refund's transaction id, and the orphan sweeper moves it to review. → The refund transaction id is logged (a number) before the document call, and CardCom's reports find the refund by `ExternalRefundDealId`, which is the row's id.
- **Whether CardCom emails the credit document is not set.** `IsSendByEmail` is not sent, as in the purchase's own document, and CardCom does not document its default. → Task 5.5 reads it from the real refund.
- **`PartialSum` semantics.** They are not documented beyond "Partial Sum for refund". → They are sent only for a real partial, and the first partial refund is checked in CardCom's panel.
- **The "no card" text is slightly off for CardCom.** → This is listed as a known limitation. The text is shared with SUMIT.

## Migration Plan

Code and tests, then the owner builds and deploys. The first real ₪1 refund is run by the owner from admin and checked in CardCom's panel. Rollback is a code revert. Nothing changes in the database.

## Verified facts

**Task 4.1, first real refund (18.10.2026 21:05, build of 21:01, event "בדיקת פיי", ₪1).**
- **Measured, from the ledger:** the refund row is succeeded and is linked to the payment's row.
  - CardCom answered code 0, "עסקה זוכתה בהצלחה".
  - It returned a refund transaction id (`NewTranzactionId`).
  - The answer had NO credit document: no number, no type, no link. So the row carries the "credit document not confirmed" note, and staff got the warning (D4).
- **Confirmed by the owner in CardCom's panel (18.10.2026):** CardCom issued no credit document ("לא הפיקה"). So the `Document` object in `RefundByTransactionId` is ignored, and D6 is built.
- **Its credit document, issued once afterwards (18.10.2026, owner-approved):** a one-time script sent the same `Documents/CreateDocument` request D6 builds, with `DealNumbers: [{ DealNumber: 266908772 }]`, ₪1, to the cardholder recorded on the payment.
  - **Measured:** CardCom answered code 0, `DocumentType` `ReceiptRefund`, `DocumentNumber` 3, with a document link. This is the first measurement of D6's request.
  - **Not changed:** the refund's ledger row keeps its "credit document not confirmed" note and no document number, because a succeeded row is immutable (`payment_operations_guard_update`). Credit receipt 3 is recorded in CardCom only.
  - **To read in CardCom's panel (owner):** that receipt 3 is linked to the refund deal, that it shows ₪1 as a credit, and whether it was emailed to the cardholder.
