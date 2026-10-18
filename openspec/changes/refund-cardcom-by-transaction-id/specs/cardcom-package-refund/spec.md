# Spec Delta

## Purpose

Gives a CardCom package payment back through its original transaction, then issues its credit document linked to the refund, and records CardCom's answers so staff always know whether the money came back and whether the credit document was issued.

## ADDED Requirements

### Requirement: A refund goes back through the original transaction

A CardCom package refund SHALL be made against the payment's own CardCom transaction, by its transaction id.

#### Scenario: Full refund
- **WHEN** an admin approves giving back the whole payment
- **THEN** CardCom is asked to refund that transaction, with no partial sum

#### Scenario: Partial refund
- **WHEN** an admin approves giving back less than the payment
- **THEN** CardCom is asked to refund that amount of the transaction

#### Scenario: A second refund of the same payment
- **WHEN** an earlier refund of the same payment exists
- **THEN** the request tells CardCom that more than one refund of the transaction is allowed

### Requirement: A refund needs the payment's transaction id and cardholder name

A CardCom refund SHALL be refused before anything is written or sent when the payment has no recorded CardCom transaction id or no cardholder name. The card token and its expiry SHALL NOT be required.

#### Scenario: No transaction id
- **WHEN** the payment has no recorded CardCom transaction id
- **THEN** the refund is refused as "no card" and the admin refunds by hand

#### Scenario: No token
- **WHEN** the payment has a transaction id and a cardholder name but no token
- **THEN** the refund goes ahead

### Requirement: The answer decides the outcome by the money

A refund SHALL be recorded as succeeded only when CardCom answers code 0 with a refund transaction id. A code 0 without one SHALL go to review. A non-zero code or a 4xx refusal SHALL close it as failed, and any other failure SHALL go to review without a retry.

#### Scenario: Confirmed
- **WHEN** CardCom answers 0 with a refund transaction id
- **THEN** the refund is recorded as succeeded with that id

#### Scenario: Success without a transaction id
- **WHEN** CardCom answers 0 with no refund transaction id
- **THEN** the refund goes to review and staff are alerted

#### Scenario: Refused
- **WHEN** CardCom answers a non-zero code
- **THEN** the refund is recorded as failed with CardCom's code and text, and may be tried again

### Requirement: The credit document is issued once, linked to the refund

After a confirmed refund, CardCom SHALL be asked once to create the credit document that is the counterpart of the payment's document, for the amount that went back, linked to the refund's own transaction. It SHALL NOT be asked when the refund was not confirmed, and SHALL NOT be asked a second time.

#### Scenario: Confirmed refund
- **WHEN** CardCom confirms the refund with a refund transaction id
- **THEN** CardCom is asked to create the credit document, linked to that refund transaction, for the amount that went back

#### Scenario: Refund not confirmed
- **WHEN** the refund is refused or goes to review
- **THEN** no credit document is asked for

### Requirement: The credit document is kept or flagged, never assumed

When CardCom confirms the requested credit document, its number, type and link SHALL be kept. When the document call is refused or unclear, or its answer has no document number or another type than requested, the refund SHALL still be recorded as succeeded, with a note saying why, and staff SHALL be warned to check the document in CardCom.

#### Scenario: Document confirmed
- **WHEN** CardCom answers the document call with the requested credit document
- **THEN** the refund record keeps its number, type and link, and staff get the usual notice

#### Scenario: Document not confirmed
- **WHEN** the document call is refused, unclear, or answers with no document number or another type
- **THEN** the refund is recorded as succeeded with a note saying why, staff are warned to check the credit document in CardCom, and the document is not asked for again
