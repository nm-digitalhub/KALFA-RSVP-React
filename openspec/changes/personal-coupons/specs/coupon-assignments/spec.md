## Purpose

How a personal offer is assigned to one customer by the sales agent or by staff, what proves the customer may use it, and how it is bound to, consumed by or released from a campaign. A coupon is a price agreement, never a credit balance.

## ADDED Requirements

### Requirement: The server decides every discount

The system SHALL compute the discount and the resulting final price from the configured offer on the server. It SHALL NOT accept a discount, a percentage or a price from the sales agent or the browser.

#### Scenario: Agent asks for the configured discount
- **WHEN** the sales agent's discount tool is called for a call that is allowed an offer
- **THEN** the server returns the offer, the package's list price and the final price it computed
- **AND** the response contains no field the agent is expected to calculate

#### Scenario: A discount value is submitted
- **WHEN** a request carries a discount, a percentage or a price chosen by the caller
- **THEN** the value is ignored and the configured offer decides

### Requirement: An offer is promised only after it is saved

The system SHALL return an offer to the sales agent only after the assignment is durably recorded. When it cannot record the assignment, it SHALL return no offer.

#### Scenario: The assignment cannot be written
- **WHEN** the database refuses or fails to record the assignment
- **THEN** the tool returns that no offer is available and nothing is promised

### Requirement: A repeated request never creates a second assignment

Assigning an offer SHALL be idempotent per source:
- one per sales call for the agent;
- one per staff request key for staff.

A repeated or retried request returns the existing assignment.

#### Scenario: The tool is called twice in one call
- **WHEN** the discount tool is called again during the same sales call
- **THEN** the same assignment is returned, with the same final price, and no second row exists

### Requirement: Assigned terms are frozen

An assignment SHALL keep its own copy of the offer's terms:
- kind and value;
- package scope;
- list price and final price at assignment time;
- expiry.

A later change to the offer or the package price SHALL NOT change an assignment already made. Only the assignment's state and its campaign binding may change, and only through the defined transitions.

#### Scenario: The offer is changed after assignment
- **WHEN** staff change the offer's percentage after an assignment was made
- **THEN** the existing assignment keeps the percentage and the price it was assigned with

### Requirement: Eligibility is proven, not claimed

A personal assignment SHALL be usable only by the customer it belongs to. A link, a code or a referral id SHALL NOT prove eligibility. Two things count as proof:
- an assignment made by staff to a specific account;
- an assignment made to a phone number, usable only by an account whose phone is verified and equal to that number. After its first use it is tied to that account.

#### Scenario: Someone else holds the signup link
- **WHEN** an account without the assignment's verified phone, and without a staff assignment, opens the sales signup link
- **THEN** no offer is applied

#### Scenario: The customer verifies the assigned phone
- **WHEN** an account verifies the phone the offer was assigned to and chooses an eligible package
- **THEN** the offer is applied and the assignment is tied to that account

### Requirement: An assignment is bound to one campaign, exclusively

Binding an assignment to a campaign SHALL be atomic. A database constraint SHALL prevent the same assignment from being bound to two campaigns, or twice by concurrent requests. Preventing a double payment on one campaign does not replace this.

#### Scenario: Two campaigns try to use one assignment
- **WHEN** two requests bind the same assignment to two different campaigns at the same time
- **THEN** exactly one binding succeeds and the other request is refused

### Requirement: An unknown payment outcome never releases an assignment

An assignment bound to a campaign whose payment is pending, in review or of unknown outcome SHALL stay bound. Only the defined transitions may release or consume it.

#### Scenario: The payment goes to review
- **WHEN** the campaign's package payment is moved to review
- **THEN** the assignment stays bound to that campaign and cannot be used elsewhere

### Requirement: A coupon is not credit

A coupon SHALL NOT create, consume or appear as credit balance. It SHALL NOT be written as a negative ledger line, nor counted in `credit_applied`.

#### Scenario: A discounted package is paid
- **WHEN** a campaign with a bound assignment is paid
- **THEN** the payment's credit applied is zero and the customer's credit balance is unchanged

### Requirement: Every assignment action is audited

Each assignment, binding, release, consumption and void SHALL be recorded in the activity log with its source:
- the sales call, for the agent;
- the staff user, for staff.

The objection reason given to the agent SHALL be kept. These records SHALL NOT store payment data.

#### Scenario: The agent assigns an offer
- **WHEN** the agent's tool records an assignment
- **THEN** an activity record names the sales call, the offer and the objection reason
