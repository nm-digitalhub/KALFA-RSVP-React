# Proposal

## Why

A CardCom package refund is linked to nothing today.

- The refund is a `Transactions/Transaction` call with `Advanced.IsRefund` (`src/lib/cardcom/refund-request.ts`). It charges a new credit transaction to the card's token.
- It issues a new credit document that points at neither the original transaction nor its receipt. The owner pointed this out on 18.10.2026.
- CardCom's API has an operation that refunds the original transaction by its id: `Transactions/RefundByTransactionId`.
- CardCom's support told the owner on 18.10.2026 that it issues a credit document when it is sent the same `Document` object as `Transactions/Transaction`. That object is not in CardCom's public OpenAPI.
- The first real refund (18.10.2026 21:05) disproved it: the money came back, but CardCom issued no credit document. CardCom's OpenAPI documents another way: `Documents/CreateDocument` with `DealNumbers`, which links a document to a deal.

## What Changes

- **The endpoint.** A CardCom package refund calls `Transactions/RefundByTransactionId` with:
  - `TransactionId`: the payment's CardCom transaction id, kept on its ledger row;
  - `ApiPassword`;
  - `PartialSum`, only when less than the payment is given back;
  - `AllowMultipleRefunds`, only when an earlier refund of the same payment exists;
  - `ExternalRefundDealId`: our refund row's id.
- **The answer.** A refund is confirmed when the answer has `ResponseCode` 0 and a refund transaction id (`NewTranzactionId`).
- **The credit document.** After a confirmed refund, `Documents/CreateDocument` issues the credit counterpart of the payment's document, linked to the refund's deal by `DealNumbers: [{ DealNumber: NewTranzactionId }]`. It is sent once and never again by the code.
- **A credit document that is not confirmed** does not send a refund to review. When the document call is refused, unclear, names no document or another type, the refund is still recorded as succeeded, because the money moved. Its record says why the credit document was not confirmed, and staff are told to check it, and issue it if missing, in CardCom.
- **What a refund needs.** The payment's transaction id and cardholder name. The card token and its expiry are no longer used.
- **Retired:** the `Transactions/Transaction` refund builder, the token and expiry checks, and the `Document` object inside `RefundByTransactionId` (sent once, on 18.10.2026 21:05, and ignored by CardCom).
- **Not changed:**
  - the ledger guards: a pending row before the call, the limit checked again, one refund per request, and a 4xx is a refusal while anything unclear goes to review;
  - the terminal check;
  - the admin cancellation flow;
  - SUMIT refunds.

## Capabilities

### New Capabilities

- `cardcom-package-refund`: how a CardCom package payment is given back: by its original transaction, then a credit document linked to the refund, and how both answers are recorded.

### Modified Capabilities

None (`openspec/specs/` is empty).

## Impact

- **Code:**
  - `src/lib/cardcom/refund-request.ts`;
  - `src/lib/payments/cardcom-refund.ts`;
  - their tests;
  - the comment in `src/lib/payments/package-refund-types.ts`;
  - `docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md` 4.8.
- **Database:** none.
- **CardCom:** a different refund operation, and a second call that issues the credit document. No real refund runs until the owner starts one from admin.
- **Known limitation:** the shared "no card" refusal text ("אין כרטיס שמור") also covers a CardCom payment with no recorded transaction id.
