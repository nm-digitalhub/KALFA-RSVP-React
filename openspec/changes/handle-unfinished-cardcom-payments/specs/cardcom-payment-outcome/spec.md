# Spec Delta

## Purpose

Decides what happens to a CardCom package payment that has not finished: which reports may close it, which session a page settles, how the page notices a wallet payment that never reported back, when an earlier session may be replaced, and what the buyer is told.

## ADDED Requirements

### Requirement: Only an error report closes an unpaid session from the page

When the buyer's page asks the server to settle and CardCom says the session is not paid, the server SHALL close it as failed only if CardCom's frame reported an error. If the frame reported success, the session SHALL stay open and the page SHALL be told the payment is still being checked.

#### Scenario: Error reported, not paid
- **WHEN** CardCom's frame reported an error and CardCom says the session is not paid
- **THEN** the payment is recorded as failed and the buyer may try again

#### Scenario: Success reported, not yet paid
- **WHEN** CardCom's frame reported success and CardCom says the session is not paid yet
- **THEN** the payment stays pending, the page asks again a bounded number of times, and then tells the buyer the payment is being checked

#### Scenario: Success reported and paid
- **WHEN** CardCom's frame reported success and CardCom confirms the payment
- **THEN** the payment is recorded as succeeded and the campaign is started as today

#### Scenario: Webhook and sweep unchanged
- **WHEN** CardCom's webhook arrives, or the periodic sweep finds a session older than its abandon time
- **THEN** the session is settled by the same rules as before this change

### Requirement: A page settles the session it is paying on

The settle request SHALL settle the session the buyer's page is paying on when the page names it and that session belongs to the same campaign; otherwise it SHALL settle the campaign's newest session. A named session of another campaign SHALL be ignored.

#### Scenario: Two tabs, older one pays
- **WHEN** a page paying on an earlier session asks to settle while a newer session exists
- **THEN** the earlier session is the one settled

#### Scenario: Session of another campaign
- **WHEN** the page names a session that does not belong to this campaign
- **THEN** it is ignored and the campaign's newest session is settled

#### Scenario: No session named
- **WHEN** the page names no session
- **THEN** the campaign's newest session is settled

### Requirement: The page checks the payment after a wallet interaction that reports nothing

After the buyer interacts with the wallet frame, while no result has arrived, the page SHALL ask the server read-only, when it regains focus and at a bounded interval for a bounded time. A read-only check SHALL never close a session.

#### Scenario: Paid without a report
- **WHEN** a read-only check finds the payment confirmed
- **THEN** the page shows the paid screen and the campaign is started as after any payment

#### Scenario: Not paid yet
- **WHEN** the checks end and CardCom has not confirmed a payment
- **THEN** the page says the payment has not completed yet, keeps the form and its session, and the payment record stays pending

#### Scenario: A result arrives
- **WHEN** CardCom's frame reports a result while checks are running
- **THEN** the checks stop and the result is settled as any reported result

#### Scenario: No wallet interaction
- **WHEN** the buyer never interacted with the wallet frame
- **THEN** no read-only checks run

### Requirement: A recent unpaid session is not replaced

Opening the payment form SHALL replace an earlier pending session only when it is older than the replace window or CardCom confirms it paid. A pending session younger than the window that CardCom reports unpaid SHALL be left open, and the page SHALL say a previous attempt is still being checked.

#### Scenario: Recent attempt, other tab or reload
- **WHEN** the form is opened while an earlier session younger than the window is pending and CardCom says it is not paid
- **THEN** no new session opens, the earlier session stays pending, and the buyer reads that a previous attempt is still being checked

#### Scenario: Old attempt
- **WHEN** the form is opened while an earlier pending session is older than the window and CardCom says it is not paid
- **THEN** it is closed as replaced and a new session opens

#### Scenario: Earlier attempt paid
- **WHEN** CardCom says the earlier session was paid
- **THEN** the page reports the payment and no new session opens

#### Scenario: Earlier attempt unreadable
- **WHEN** CardCom cannot be asked about the earlier session
- **THEN** it is left as it is and the page says the payment is in progress

### Requirement: The buyer is told "not completed", not "declined"

When a session is closed as failed after an error that is not one of CardCom's 3D Secure failures, the page SHALL say the payment was not completed and nothing was charged, and SHALL NOT say the card company declined it.

#### Scenario: Ordinary failure
- **WHEN** the session is closed as failed after an error with no 3D Secure code
- **THEN** the buyer reads that the payment was not completed and nothing was charged, with a way to try again

#### Scenario: 3D Secure failure
- **WHEN** the error was a 3D Secure timeout or refusal
- **THEN** the buyer reads the existing 3D Secure sentence
