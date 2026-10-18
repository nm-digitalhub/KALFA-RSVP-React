# Proposal

## Why

Owner request 18.10.2026: let a buyer pay the fixed-price package with Google Pay, not only by typing a card.

Measured on 18.10.2026:
- **Today only a typed card is possible.** The CardCom form (`cardcom-open-fields-form.tsx`) renders four CardCom iframes: master, card number, CVV, reCAPTCHA. `src/lib/cardcom/open-fields.ts:21-22` says Google Pay is "not in the pilot", and `setCardOwnerDetails`, the message CardCom requires for it, appears nowhere in `src`.
- **The settlement path already fits a wallet.** The page listens for CardCom's `HandleSubmit` / `HandleEror` messages, ignores action-less 3D Secure traffic, and treats every message only as a reason to ask the server. The server asks CardCom (`GetLpResult`) and alone decides (`cardcom-settle.ts`). The three callers that settle (CardCom's webhook, the buyer's call, the sweeper) are idempotent.
- **CardCom documents the wallet path** (`docs/cardcom/response (3).md`, and its public sample read live on 18.10.2026): a separate `GooglePay` iframe with `allow="payment"`; no `doTransaction`; the answer returns through `HandleSubmit` / `HandleError`; and name, email and phone must first be sent to the master frame with `setCardOwnerDetails`, because Google Pay does not supply them and 3D Secure needs them.
- **The ledger can already name the channel.** `payment_operations.provider_payment_vector` stores CardCom's `ExternalPaymentVector` (`GooglePay` is one of its values). All 14 live CardCom rows have it null, so no wallet payment has ever been recorded.

Two live facts bound the work: 5 of 6 real CardCom refund attempts failed, all on the afternoon of 9.10.2026 (three with CardCom code 9006, "the user has no permission to refund"), and the terminal's Google Pay enablement at CardCom is unverified.

## What Changes

- **A Google Pay option on the package payment page**, shown above the card fields, only while an admin switch is on and the purchase is going through CardCom.
- **An admin setting, off by default**, beside the existing save-card switch in the CardCom integration form, with three positions: off, platform administrators only, everyone. Nothing changes for any buyer until the owner moves it, and the real-money acceptance can run on production with administrators only.
- **Cardholder details sent to CardCom before a wallet payment.** The form pushes the buyer's name, email and phone to CardCom's master frame (to its origin only), keeps them current as the buyer edits them, and keeps the wallet button unusable until all three are valid.
- **The same server-side settlement.** A message from the Google Pay frame is only a reason to ask the server; the wallet payment is recorded, checked (amount, currency, terminal) and activated exactly like a card payment.
- **A buyer who comes back from a redirect is recognised.** If the wallet flow leaves the page and returns, the paid session is settled and the campaign is started, as it would have been in-page. This also closes the same gap for a 3D Secure redirect.
- **The channel is recorded and visible.** The ledger row keeps `GooglePay` as the payment channel when CardCom reports it, and payment review shows it.
- **Withheld while the card must be saved.** If the save-card switch is on, the wallet option is not offered, because a wallet payment may not return the reusable token that setting promises.

**Gates, recorded in design and not decided here:**
- CardCom enables Google Pay on the live terminal, and tells us any domain or merchant registration it needs.
- Whether a wallet payment still needs the cardholder ID, address and reCAPTCHA, and which receipt it produces.
- The failed-refund pattern is understood before wallet money is accepted.
- Acceptance is a real ₪1 wallet charge and its refund on the real terminal, each run approved by the owner; the test terminal moves no money and does not count.

**Non-goals:**
- Apple Pay (needs a domain registration with Apple, a separate change), Bit and other wallets.
- Anything on the SUMIT fallback form.
- Changing the card flow, the owner-ID requirement, the pricing or the refund logic.

## Capabilities

### New Capabilities
- `google-pay-payment`: offering Google Pay on the package payment page, the details it needs, how its result is settled and recorded, and when it is withheld.

### Modified Capabilities
- None. `openspec/specs/` is empty; nothing is archived yet.

## Impact

- **Code:** `src/lib/cardcom/open-fields.ts` (a typed `setCardOwnerDetails` message, the Google Pay frame address and id), `cardcom-open-fields-form.tsx` (the frame, gating, detail pushing, the redirect-return settle call), `src/lib/data/cardcom-config.ts` and the admin CardCom config files (the new switch), `package-payment-view.tsx` / `page.tsx` (passing the switch and terminal), and the payment-review screen (showing the channel).
- **Database:** one column on `cardcom_config` and one parameter on its save function. Applied only by the owner.
- **No change** to CardCom settings from our side, to the ledger's money columns, to settlement rules, or to any other route.
- **Security and privacy:** card and wallet data stay inside CardCom's frames. We send only name, email and phone, to CardCom's master frame with `'*'` as CardCom's sample does (owner, 18.10.2026), and read only CardCom's origin. The new frame is the only one with the `payment` permission.
- **Docs:** the CardCom plan and `open-fields.ts` header comment are updated to say Google Pay is built and behind a switch.
