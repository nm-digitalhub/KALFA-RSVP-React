# Tasks

Approved by the owner on 18.10.2026 ("כן ותממש"). Nothing is deployed, refunded or charged by this work. The owner builds, deploys and runs the first real refund.

## 1. The request

- [x] 1.1 Replace `buildRefundTransaction` and `expiryMMYY` in `src/lib/cardcom/refund-request.ts` with `buildRefundByTransactionId`. Its type is derived as `RefundByTransactionIdReq & { Document: DocumentTran }`. It sends `TransactionId`, `ApiPassword`, `ExternalRefundDealId`, `PartialSum` only for a partial, `AllowMultipleRefunds` only after an earlier refund, and the credit `Document`. Verify: `refund-request.test.ts` covers the full, partial and second refunds, the document, the email cut and absent, and refuses each invalid input. No token or expiry is sent. *(The `Document` part is superseded by 5.1.)*

## 2. The refund

- [x] 2.1 In `src/lib/payments/cardcom-refund.ts`, the refund needs the payment's transaction id and cardholder name (token and expiry no longer read), calls `transactionsRefundByTransactionId`, and handles the answer per design D3 and D4. Verify: `cardcom-refund.test.ts` keeps every safety test, re-pointed to the new call: the pending row first, the limit checked twice, one refund per request, a 4xx declined, the unclear in review and never retried, the password never logged. It adds:
  - the exact request;
  - a partial refund sends `PartialSum`, and a second one `AllowMultipleRefunds`;
  - code 0 without a transaction id goes to review;
  - a document in the answer is kept;
  - no document gives succeeded with a note and a warning;
  - a payment with no transaction id or no cardholder name is refused as `no_card`;
  - a payment with no token still refunds.

## 3. Documentation

- [x] 3.1 Update the comment in `package-refund-types.ts` (`no_card` for CardCom) and pilot plan 4.8, so they describe this refund and no longer say `RefundByTransactionId` issues no document. Verify: no file in `src/` or `docs/` still describes the token refund as current.
- [x] 3.2 Run the focused tests, `tsc` and `eslint` on the changed files, and `openspec validate`. Verify: all pass.

## 4. The real refund (owner)

- [x] 4.1 After the owner deploys, the owner opens a cancellation request on one of the three unrefunded ₪1 test events and approves it in admin with ₪1. Verify: the ledger row and CardCom's panel show whether the refund succeeded, whether a credit document number came back in the answer, and whether CardCom shows the credit linked to the original receipt. The findings are recorded in design.md.

## 5. The credit document by CreateDocument (design D6)

Under the owner's approval of a refund with a credit document ("כן ותממש", 18.10.2026). Built because 4.1 showed the refund issues none: the owner found no document in CardCom's panel ("לא הפיקה"). From this build on, every confirmed refund issues a tax credit document by itself.

- [x] 5.1 In `src/lib/cardcom/refund-request.ts`, remove `Document` from `buildRefundByTransactionId` (its type is now the generated `RefundByTransactionIdReq`), and add `buildCreditDocument`, typed `CreateDocumentRequest`, with `DealNumbers: [{ DealNumber: refundTransactionId }]`. Verify: `refund-request.test.ts` pins both requests exactly, the partial amount, the tax-invoice counterpart, the email cut and absent, and refuses each invalid input.
- [x] 5.2 In `src/lib/payments/cardcom-refund.ts`, after a confirmed refund call `documentsCreateDocument` once, and record its document per D4 and D6. Verify: `cardcom-refund.test.ts` shows the document call after the refund, linked to `NewTranzactionId`; none after a refusal, a review or a success without a transaction id; a refused, rejected, unclear, numberless or other-type answer gives succeeded with a note and a warning and no second call; the password never logged; CardCom's document text never in an alert.
- [x] 5.3 Update the comment in `src/lib/cardcom/document-types.ts` and pilot plan 4.8 for the two calls. Verify: no file in `src/` or `docs/` still says the refund carries a `Document` object as current.
- [x] 5.4 Run the focused tests, `tsc` and `eslint` on the changed files, and `openspec validate`. Verify: all pass.
- [ ] 5.5 After the owner deploys, the owner refunds one of the two unrefunded ₪1 test payments from admin. Verify: the ledger row has the credit document number and type, and CardCom's panel shows the credit document linked to the refund, for ₪1 as a credit (amount and direction), and whether CardCom emailed it to the cardholder. The findings are recorded in design.md.

## Workflow follow-up

- Archive after task 5.5 is recorded and the owner approves.
