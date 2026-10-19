# Cardcom Production Checklist

What a working sandbox integration still gets wrong in production. Each item names its source:
the V11 OpenAPI spec (`https://secure.cardcom.solutions/swagger/v11/swagger.json`) or a Cardcom
knowledge-base article. Most KB articles describe Cardcom's older Name-to-Value interface; where
the V11 field differs, the V11 name is given and the mapping is marked as such.

## 1. Before you sell a subscription

- **Token charging needs Cardcom's tokens module** (KB 26960101857298, titled "חיוב/ זיכוי
  אסימון (דרוש מודול אסימונים)"). Confirm it is on the merchant's account before building a
  monthly plan.
- **The charging terminal must not require CVV.** The same article: "לחיוב אסימון חייב להיות
  מסוף ללא חובה ל-CVV בחברות האשראי". On a CVV-required terminal the article's
  `ApprovalNumber` row says a token cannot be charged without passing an approval number, and a
  J5 approval number may be used only once, so a recurring job would need a fresh hold for every
  charge. Ask Cardcom whether the merchant has (or needs) a separate no-CVV terminal for token
  charges.
- **Token retention.** With the tokens / standing-order module Cardcom keeps the token until
  the card expires; without it, only 6 months and only for future refunds (same article). Use
  `TokenInfo.TokenExDate` from `GetLpResult` as the authoritative purge date.
- **Standing-order terminals.** The legacy `TokenToCharge.IsAutoRecurringPayment` flag (V11:
  `Advanced.IsAutoRecurringPayment`) is only for a terminal set up as a standing-order
  terminal; the article says not to send it on a regular or phone terminal without CVV.

## 2. Document lines must equal the charge

KB 26955677133074: "יש לדאוג שסה"כ שורות החשבונית שווה לסכום החיוב". A line's total is price
times quantity (or `TotalLineCost` when quantity has decimals, per the spec), and a discount can
be a negative line as long as the document total still equals the charge exactly. Because the
lines must add up to the charged `Amount`, which the cardholder pays including VAT, enter line
prices so that they sum to that gross amount. Cardcom gives the charge priority over the
document (KB 27008946189074: "gives priority to billing"), so a mismatch can leave a charged
card with no invoice.

## 3. Releasing a J5 hold

- A J5 hold lasts "3 ימים עד שבועיים, ולפעמים חודש", depending on the merchant's agreement
  with the card company (KB 26984210838034).
- The KB releases it through the legacy token-charge call with `TokenToCharge.MTI=420` plus
  `TokenToCharge.ApprovalNumber` set to Cardcom's deal number of the hold. V11's `AdvancedTran`
  has `MTI` and `ApprovalNumber` fields, but the spec gives `MTI` no description, so confirm the
  V11 release call with Cardcom support before relying on it.
- The test terminal cannot run J5 ("במסוף טסטים שלנו לא ניתן לבצע תפיסת מסגרת J5"), so it
  cannot release one either. Test holds on the merchant's real terminal with a minimal amount.
- KB 26960101857298: an approval number from a J5 may be used only once.

## 4. Webhook and order state

- **Persist, then acknowledge.** Write the webhook hit to a durable queue or table before
  returning HTTP 200. Cardcom stops re-sending once it gets a 200 (legacy `IndicatorUrl`
  documentation: up to 7 attempts, KB 27008964534162), so an event acknowledged and then lost
  in a crash is gone.
- **Sweep pending orders.** Do not depend on the webhook arriving. Poll `GetLpResult` for
  `LowProfileId`s still pending. A Low Profile page times out 20 minutes after it is opened, and
  the page code expires 24 hours after you create it (KB 27007108827922), so after 24 hours a
  pending order is abandoned.
- **One page per order.** Create at most one live Low Profile page per order (store the
  `LowProfileId` against the order and reuse it), so a double-clicked Pay button cannot produce
  two payable pages.
- **The redirect is not the result.** In the legacy interface Cardcom calls the notify URL
  before sending the cardholder to the success page (KB 27008964534162). Your success page should
  read your own order record (and poll it), not call `GetLpResult` itself.

## 5. Idempotency beyond the charge

- `Documents/CreateDocument` has no idempotency key (spec: `CreateDocumentRequest` properties
  are `ApiName`, `ApiPassword`, `Document`, `Cash`, `Cheques`, `CustomFields`, `DealNumbers`,
  `IsSendSMS`). Put your own id in `Document.ExternalId` and, before re-issuing after a timeout,
  search with `Documents/GetReport` (date range, `AccountId` or customer name) for a document
  carrying it.
- `RefundByTransactionId.AllowMultipleRefunds` defaults to `false` in the spec. That default is
  your guard against a second refund of the same transaction; a partial-refund flow that sets it
  `true` must keep its own record of what was already refunded.
- Record a refund intent in your database before calling the API, and the result after, so a
  crash between the refund and the credit document can be resumed.

## 6. Secrets and logging

- `Transactions/Transaction` requires only `TerminalNumber`, `ApiName` and `Amount` (spec), so
  `ApiName` plus a stored `Token` is enough to charge a saved card. Treat `ApiName`,
  `ApiPassword` and every token as secrets: server-only environment variables (in Next.js never
  a `NEXT_PUBLIC_*` variable), calls only from route handlers or server actions, tokens stored
  encrypted and never returned to the browser.
- Do not log full responses. `TransactionInfo` and `TokenInfo` carry `Token`,
  `CardOwnerIdentityNumber`, `CardOwnerEmail` and `CardOwnerPhone` (spec). Log `ResponseCode`,
  `Description`, `TranzactionId` and `Last4CardDigitsString`, and mask the rest. The bundled
  validator masks these fields in its own output.
