# Proposal

## Why

On 18.10.2026 every real CardCom payment ended with GetLpResult `5119`. CardCom's own description of that code, stored on all ten recent ledger rows, is "עסקה ממתינה או לא הושלמה" (pending or not completed). Our code treats it as a final decline in three places, and so far it has stayed silent in a fourth:

- **Closed on the first answer.** Whenever CardCom's frame reports any result, the page asks the server with `submitted: true`, and `settleCardcomSession` closes the row as failed on the first non-zero answer (`cardcom-settle.ts:320-329`). That happens even when the frame reported success.
- **Replaced while still open.** Opening the form again (a reload, another tab) closes the earlier session as replaced and opens a new one (`cardcom-purchase.ts:107`). The earlier session can still be paid at CardCom. A late payment then lands on a failed row, which only raises an alert, and the buyer can pay a second time.
- **The wrong session is settled.** The settle route settles the campaign's newest session (`settle/route.ts:43-57`), not the one the buyer's page is paying on.
- **No check after Google Pay.** The page reacts only to messages from CardCom's frames (`cardcom-open-fields-form.tsx:319-352`). After a return from Google Pay with no `HandleSubmit` or `HandleEror`, the page stays as it was and never asks the server.
  - 18.10, 14:32 (iPhone): the page was left stuck after the return from Google.
  - 18.10, 17:51: one session, no settle call, and the row is still pending.

The buyer is also told "נדחה על ידי חברת האשראי" for every non-zero answer. CardCom itself says "not completed".

## What Changes

- **A success report never closes a payment as failed.** When CardCom's frame reports success and GetLpResult is still non-zero, the row stays pending. The page asks again for a bounded time, then says the payment is being checked. The webhook and the sweeper settle it as they do today.
- **An error report still closes the session.** When CardCom's frame reports an error (its own payment process has stopped), the session is closed as failed and its frames are withdrawn, as today. The buyer reads "the payment was not completed and nothing was charged", not "declined by the card company". The 3D Secure sentences stay.
- **The page settles its own session.** The settle route settles the session the page is paying on. The browser names it, and the server accepts it only when that session belongs to this campaign. The newest session remains the fallback.
- **The page checks after a wallet interaction.** After the buyer interacts with the Google Pay frame and no result arrives, the page asks the server read-only, when it regains focus and at a bounded interval:
  - paid: the page shows the paid screen;
  - otherwise: the page says the payment has not completed yet and keeps the form, its session and the row as they are.
- **A recent unpaid session is not replaced.** A new opening of the form replaces a pending session only when that session can no longer be paying: it is older than a set window, or the server already closed it after an error. A younger pending session that CardCom reports unpaid leaves the page in "a previous attempt is still being checked". The window length is the owner's decision (design D5).
- **Not changed:**
  - terminal settings, 3D Secure settings and the Create request;
  - the webhook's and the sweeper's rules;
  - the ledger's compare-and-set.
- **Not built:** a confirmation that CardCom received `setCardOwnerDetails`. CardCom's master frame posts nothing back for that message (`OpenFields.ts:298-314`, script v5.0.9784.18617), so there is nothing to wait for.

## Capabilities

### New Capabilities

- `cardcom-payment-outcome`: how a CardCom payment that has not finished is recognised, kept open, settled and told to the buyer. It covers:
  - which reports may close a session;
  - which session a page settles;
  - the check after a wallet interaction;
  - when an earlier session may be replaced;
  - the buyer's sentences.

### Modified Capabilities

None in `openspec/specs/` (it is empty). This change narrows a requirement of the in-flight change `add-google-pay-cardcom` (capability `google-pay-payment`, requirement "Every opening of the payment form gets a new session"): a recent pending session is no longer replaced on sight. That change's spec is updated to point here (task 6.2), so the two never disagree.

## Impact

- **Code:**
  - `src/lib/payments/cardcom-settle.ts`: the closing rule after a success report;
  - `src/app/api/campaigns/[id]/purchase/settle/route.ts`: the browser's session id and the report kind;
  - `src/lib/payments/cardcom-purchase.ts`: the replace window in `resolvePending`;
  - `cardcom-open-fields-form.tsx`: the report kind, the session id, the check after a wallet interaction, and the sentences;
  - `src/lib/payments/package-purchase-errors.ts`: the new sentences;
  - the tests of each.
- **Database:** none. The ledger's columns, constraints and functions are unchanged.
- **CardCom:** only more read-only GetLpResult calls, while a page is checking. They are bounded in number and spacing.
- **Risk:** a buyer whose earlier attempt is recent waits up to the replace window before a new session opens. That trade-off against a possible second charge is the owner's decision (D5).
