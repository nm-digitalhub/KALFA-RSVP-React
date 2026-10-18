# Spec Delta

## Purpose

Lets a buyer pay a fixed-price package with Google Pay on the CardCom payment form, while keeping the payment decided, recorded and activated by the server exactly as a card payment is.

## ADDED Requirements

### Requirement: Google Pay is offered only as an administrator has set it

The payment page SHALL offer Google Pay only according to an administrator-controlled setting with three positions: off, administrators only, everyone. The setting SHALL be off by default and SHALL be changeable only by a person who may configure the integration. The option SHALL also require that the purchase is taken through CardCom and is payable.

#### Scenario: Setting off
- **WHEN** the setting is off
- **THEN** the page shows the card form exactly as before and no Google Pay option

#### Scenario: Setting everyone
- **WHEN** the setting is everyone and the payment form is shown through CardCom
- **THEN** a Google Pay option appears above the card fields

#### Scenario: Setting administrators only, ordinary buyer
- **WHEN** the setting is administrators only and the buyer may not configure the integration
- **THEN** no Google Pay option is shown

#### Scenario: Setting administrators only, administrator
- **WHEN** the setting is administrators only and the buyer may configure the integration
- **THEN** the Google Pay option appears

#### Scenario: Purchase not through CardCom
- **WHEN** the purchase is not taken through CardCom
- **THEN** no Google Pay option is shown

#### Scenario: Setting unreadable
- **WHEN** the setting cannot be read
- **THEN** it is treated as off

#### Scenario: Non-administrator changes the setting
- **WHEN** a user who may not configure the integration tries to change it
- **THEN** the server refuses and the setting is unchanged

### Requirement: Google Pay is withheld while the card must be saved

The page SHALL NOT offer Google Pay while the setting that saves the buyer's card for later charges is on.

#### Scenario: Save-card setting on
- **WHEN** the Google Pay setting would offer the option and the save-card setting is on
- **THEN** the page shows only the card form

### Requirement: The wallet cannot be used before the buyer's details are valid

The page SHALL send the buyer's name, email and phone to CardCom's payment frame before any wallet payment, SHALL send them again whenever the buyer changes them, and SHALL keep the Google Pay option unusable until all three are valid.

#### Scenario: Details valid
- **WHEN** the name, email and phone are valid
- **THEN** CardCom's frame receives them and the Google Pay option is usable

#### Scenario: Details edited
- **WHEN** the buyer changes the email to another valid address
- **THEN** CardCom's frame receives the new value before a payment can start

#### Scenario: Details invalid
- **WHEN** any of the three is empty or invalid
- **THEN** the option is shown as unavailable with a sentence saying which detail is missing, and cannot be activated

### Requirement: Messages travel only between the page and CardCom

The page SHALL send every message to CardCom's coordinating frame exactly as CardCom's sample and documentation write the call, with `'*'` as the target (`postMessage(message, '*')`, by the owner's decisions of 18.10.2026: first for the cardholder's details, then for `init` and `doTransaction` too), and to no other frame. The page SHALL act only on messages whose origin is CardCom's. A message with no action name SHALL be ignored.

#### Scenario: Message from another origin
- **WHEN** a message claiming to be a payment result arrives from any other origin
- **THEN** it is ignored and nothing is settled

#### Scenario: Message with no action
- **WHEN** a message without an action name arrives from CardCom
- **THEN** it is ignored

#### Scenario: Details message target
- **WHEN** the page sends the buyer's details
- **THEN** the message is CardCom's documented call, `{ action: 'setCardOwnerDetails', data }` with `'*'` as the target, posted to CardCom's coordinating frame and to no other frame

#### Scenario: Init and payment target
- **WHEN** the page initialises CardCom's frames or submits a card payment
- **THEN** `init` and `doTransaction` are posted to CardCom's coordinating frame with `'*'` as the target, as in CardCom's sample

### Requirement: A wallet payment is settled by the server, never by the browser

The server SHALL decide the outcome of a Google Pay payment only from CardCom's own answer about the session. A result message from the frame SHALL be only a reason to ask the server. The payment SHALL pass the same amount, currency and terminal checks as a card payment, and an answer that does not match SHALL go to manual review and SHALL NOT be counted paid.

#### Scenario: Paid
- **WHEN** the frame reports a result and CardCom confirms the session was paid for the expected amount
- **THEN** the payment is recorded as succeeded and the campaign is started

#### Scenario: Declined or cancelled
- **WHEN** CardCom reports the session was not paid
- **THEN** the payment is recorded as failed, the buyer is told in the page's own words, and may try again

#### Scenario: The browser lies
- **WHEN** the frame reports success but CardCom's answer shows no payment
- **THEN** nothing is recorded as paid

#### Scenario: Amount mismatch
- **WHEN** CardCom confirms a charge whose amount differs from the ledger
- **THEN** the payment goes to manual review and is not counted paid

### Requirement: A buyer returning from a redirect is recognised

When a wallet payment completes through a redirect that returns the buyer to the payment page, the page SHALL settle the session and start the campaign exactly once, as it does when the result arrives in the page.

#### Scenario: Paid during the redirect
- **WHEN** the buyer returns to the payment page and CardCom reports the session paid
- **THEN** the payment is recorded, the campaign is started if it was waiting for payment, and the page shows the paid state

#### Scenario: Already running
- **WHEN** the campaign was already started by the webhook or another tab
- **THEN** it is not started a second time

### Requirement: The payment channel is recorded and shown to staff

When CardCom reports the channel of a payment, the system SHALL keep it on the payment record, and payment review SHALL show it. A payment whose channel CardCom did not report SHALL show no channel rather than a guess.

#### Scenario: Wallet payment
- **WHEN** CardCom reports the channel as Google Pay
- **THEN** the record keeps it and payment review shows "Google Pay"

#### Scenario: Channel not reported
- **WHEN** CardCom reports no channel
- **THEN** the record keeps none and review shows none

### Requirement: The card form keeps working when the wallet does not

If the Google Pay frame fails to load, or the browser cannot use it, the page SHALL still allow paying by card with no loss of function.

#### Scenario: Frame fails to load
- **WHEN** CardCom's Google Pay frame cannot be loaded
- **THEN** the card form works normally and the page shows no error for the wallet

### Requirement: A wallet payment is refundable like a card payment

A succeeded Google Pay payment SHALL be refundable through the same refund path as a card payment, and the refund SHALL be recorded in the same ledger.

#### Scenario: Refund of a wallet payment
- **WHEN** an authorized person refunds a succeeded Google Pay payment
- **THEN** the refund is attempted through CardCom and its outcome is recorded against the payment

### Requirement: The buyer is told what 3D Secure is doing and why it failed

While the bank checks the cardholder (3D Secure), the payment form SHALL say so, for a card payment and for a wallet payment alike, and SHALL accept no other payment until a result is settled. When 3D Secure does not complete or is refused, the form SHALL say that the bank's check did not complete, and SHALL NOT say the card was declined. The server SHALL still decide whether a payment happened.

#### Scenario: The bank checks the device
- **WHEN** CardCom announces the device check
- **THEN** the form says the payment is being verified with the bank, that the page must stay open, and that nothing should be pressed again

#### Scenario: The bank asks the cardholder
- **WHEN** CardCom announces the cardholder challenge
- **THEN** the form shows the same sentence, and never asks the buyer to complete the verification, because CardCom never says when the bank's window has closed

#### Scenario: The form is locked while the bank checks
- **WHEN** CardCom announces a 3D Secure step for a wallet payment, while the form still accepts payments
- **THEN** the wallet, the pay button and every field become unusable until the server settles a result, as they are for a submitted card

#### Scenario: The check times out
- **WHEN** CardCom reports that 3D Secure timed out and the server settles the session as not paid
- **THEN** the buyer reads that the verification did not complete in time, with a way to try again, and does not read that the card was declined

#### Scenario: The check is refused
- **WHEN** CardCom reports that 3D Secure was refused and the server settles the session as not paid
- **THEN** the buyer reads that the verification was not approved, and does not read that the card was declined

#### Scenario: Any other failure
- **WHEN** the session is settled as declined for any other reason
- **THEN** the form keeps its existing declined sentence

#### Scenario: Nothing from the bank is shown or kept
- **WHEN** 3D Secure messages arrive
- **THEN** only the name of the step, a numeric code and the label of one of CardCom's own fixed 3D Secure sentences are used, and no address, transaction id or other text from CardCom or the bank is displayed, logged or stored

#### Scenario: A failed payment says what the browser reported
- **WHEN** the buyer's form asks the server to settle after CardCom reported a 3D Secure error, and the server closes the payment as failed
- **THEN** the failed record's note carries how the buyer was paying (card or Google Pay), the error's number, the last 3D Secure step and the label of CardCom's sentence, worded as what the buyer's browser reported, and that report decides nothing about whether the payment happened

#### Scenario: Card or Google Pay is told apart
- **WHEN** a result arrives and the form had submitted a card
- **THEN** the report says the buyer was paying by card; and when a result arrives with no card submitted, it says Google Pay, because a card is only ever submitted from the form while the wallet's button is inside CardCom's frame

#### Scenario: The report is only numbers and fixed labels
- **WHEN** a report holds anything other than a number and a fixed label, or arrives without the form having submitted
- **THEN** the server ignores it and the payment is settled exactly as it would be without it

### Requirement: Every opening of the payment form gets a new session

CardCom's guide says to create a new LowProfile each time a payment form is submitted. Opening the payment form SHALL therefore never hand back an earlier session: an earlier unpaid session SHALL be settled first and, when CardCom says it was not paid, closed as replaced, and a new session SHALL open. A session CardCom says was paid SHALL be reported as paid and nothing new SHALL open.

#### Scenario: Reload or another tab
- **WHEN** the buyer opens the payment form while an earlier session is still unpaid
- **THEN** the earlier session is closed as replaced, with a note that says so and no "declined" alert, and the form opens with a new session

#### Scenario: Paid in the other tab
- **WHEN** the earlier session turns out to have been paid
- **THEN** the page reports the payment and no new session opens

#### Scenario: The earlier session cannot be read
- **WHEN** CardCom cannot be asked about the earlier session
- **THEN** it is left as it is and the page says the payment is in progress; nothing is overwritten on a guess
