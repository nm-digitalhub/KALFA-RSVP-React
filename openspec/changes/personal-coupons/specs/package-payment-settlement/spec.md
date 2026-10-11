## Purpose

What a package payment reported by the clearing company must match before the system records it as paid, and what happens when it does not match or cannot be checked.

## ADDED Requirements

### Requirement: A payment counts as paid only when its amount and currency match

The system SHALL record a package payment as succeeded only when all of the following hold:
- the clearing company reports success;
- the reported charged amount equals the ledger row's amount;
- the reported currency is shekels.

#### Scenario: The amounts match
- **WHEN** CardCom reports a successful charge of exactly the ledger amount in shekels
- **THEN** the payment is recorded as succeeded

#### Scenario: The amounts differ
- **WHEN** CardCom reports a successful charge of a different amount
- **THEN** the payment is moved to review, staff are alerted, and the campaign is not treated as paid

#### Scenario: The amount or currency is missing
- **WHEN** CardCom's answer does not include the charged amount or the currency
- **THEN** the payment is moved to review and is not treated as paid

### Requirement: A refund is limited to what was actually charged

The refundable amount SHALL be computed from payments recorded as succeeded, which carry the verified charged amount.

#### Scenario: A refund after a discounted purchase
- **WHEN** a refund is requested for a discounted campaign
- **THEN** at most the discounted amount actually charged can be refunded
