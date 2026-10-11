## Purpose

How a personal offer is assigned to one customer for one package, by the sales agent or by staff; what proves the customer may use it; and how it is bound to, consumed by, or released from a campaign. A coupon is a price agreement, never a credit balance.

## ADDED Requirements

### Requirement: The server decides every discount from a defined offer

The system SHALL compute the discount and the resulting final price on the server, from an offer defined in the system's offer source. It SHALL NOT accept a discount, a percentage or a price from the sales agent or the browser. When no offer is defined, nothing SHALL be assigned.

#### Scenario: Agent asks for the configured discount
- **WHEN** the sales agent's discount tool is called for an offered package, during a call that is allowed an offer
- **THEN** the server returns the offer, the package, its list price and the final price it computed
- **AND** the response contains no field the agent is expected to calculate

#### Scenario: A discount value is submitted
- **WHEN** a request carries a discount, a percentage or a price chosen by the caller
- **THEN** the value is ignored and the defined offer decides

### Requirement: An assignment is for one package

Each assignment SHALL name exactly one package, together with the list price and the final price promised for it. It SHALL be bound only to a campaign for that package.

#### Scenario: The customer chooses another package
- **WHEN** a customer with an assignment for package A chooses package B
- **THEN** no discount is applied to B, and the customer is told the offer is for package A

### Requirement: An offer is promised only after it is saved

The system SHALL return an offer to the sales agent only after the assignment is durably recorded. When it cannot record the assignment, it SHALL return no offer.

#### Scenario: The assignment cannot be written
- **WHEN** the database refuses or fails to record the assignment
- **THEN** the tool returns that no offer is available and nothing is promised

### Requirement: A repeated request never creates a second assignment

Assigning an offer SHALL be idempotent per source:
- one per sales call and package for the agent;
- one per staff request key for staff.

A repeated or retried request returns the existing assignment.

#### Scenario: The tool is called twice in one call
- **WHEN** the discount tool is called again for the same package during the same sales call
- **THEN** the same assignment is returned, with the same final price, and no second row exists

### Requirement: Assigned terms are frozen

An assignment SHALL keep its own copy of the offer's terms:
- kind and value;
- the package;
- list price and final price at assignment time;
- expiry.

A later change to the offer or the package price SHALL NOT change an assignment already made. Only the assignment's state, its account (once, on claim) and its campaign binding may change, and only through the defined operations.

#### Scenario: The offer is changed after assignment
- **WHEN** staff change the offer's percentage after an assignment was made
- **THEN** the existing assignment keeps the percentage and the price it was assigned with

### Requirement: Eligibility is proven, not claimed

A personal assignment SHALL be usable only by the customer it belongs to. A link, a code or a referral id SHALL NOT prove eligibility. Two things count as proof:
- an assignment made by staff to a specific account;
- an assignment made to a phone number, usable only by an account whose phone is verified and equal to that number. After its first use it is tied to that account.

#### Scenario: Someone else holds the signup link
- **WHEN** an account without the assignment's verified phone, and without a staff assignment, opens the sales signup link
- **THEN** no offer is applied or revealed

#### Scenario: The customer verifies the assigned phone
- **WHEN** an account verifies the phone the offer was assigned to and chooses the offer's package
- **THEN** the offer is applied and the assignment is tied to that account

### Requirement: Binding is atomic and exclusive

Binding an assignment SHALL, in one database transaction, write the discount and the final price into the campaign's pricing record and mark the assignment bound. A database constraint SHALL prevent the same assignment from being bound to two campaigns, or twice by concurrent requests. Binding SHALL be refused when the campaign's pricing is locked.

#### Scenario: Two campaigns try to use one assignment
- **WHEN** two concurrent transactions bind the same assignment to two different campaigns
- **THEN** exactly one binding succeeds and the other is refused

### Requirement: Release is atomic and limited

Releasing a bound assignment SHALL, in one database transaction:
- restore the pricing record to the list price, with no discount and no assignment;
- return the assignment to assigned, or to void if it has expired;
- record the release in the assignment's history.

Release SHALL be refused when the pricing is locked, or when the campaign has a package payment that is pending, in review or succeeded, unless a rule decided by the owner allows it.

#### Scenario: A campaign is abandoned before approval
- **WHEN** a bound assignment is released for an unapproved campaign with no package payment
- **THEN** the campaign's price returns to the list price, and the assignment can be bound again

#### Scenario: Release after approval
- **WHEN** release is requested for a campaign whose pricing is locked
- **THEN** the release is refused and nothing changes

### Requirement: Consumption is recorded with the payment

An assignment SHALL become consumed in the same database transaction that records its campaign's package payment as succeeded. No repair of a missed consumption SHALL charge the customer again.

#### Scenario: The payment succeeds
- **WHEN** the campaign's package payment is recorded as succeeded
- **THEN** the bound assignment is consumed in the same transaction

### Requirement: An unknown payment outcome never releases an assignment

An assignment bound to a campaign whose payment is pending, in review or of unknown outcome SHALL stay bound.

#### Scenario: The payment goes to review
- **WHEN** the campaign's package payment is moved to review
- **THEN** the assignment stays bound to that campaign and cannot be used elsewhere

### Requirement: A coupon is not credit

A coupon SHALL NOT create, consume or appear as credit balance. It SHALL NOT be written as a negative ledger line, nor counted in `credit_applied`.

#### Scenario: A discounted package is paid
- **WHEN** a campaign with a bound assignment is paid
- **THEN** the payment's credit applied is zero and the customer's credit balance is unchanged

### Requirement: The customer can find and understand an offer

The package choice SHALL show an eligible offer on its package, with the list price, the discount and the final price. An account without a verified phone SHALL be invited to verify its phone without being told whether an offer exists. The owner of an offer SHALL be told when it is for another package or has ended.

#### Scenario: An unverified account
- **WHEN** an account without a verified phone opens the package choice
- **THEN** it sees an invitation to verify its phone, and no information about any offer

#### Scenario: An expired offer
- **WHEN** the owner of an expired offer opens the package choice
- **THEN** the package shows its list price, and the screen says the offer has ended

### Requirement: Staff can follow every assignment

Staff with `manage_billing` SHALL see each assignment's source, target, package, prices, state and bound campaign, and that campaign's package payment outcome. They SHALL be able to assign and void an assignment.

#### Scenario: An assignment held by a payment in review
- **WHEN** an assignment's campaign has a package payment in review
- **THEN** staff see the assignment as held by that review

### Requirement: Every assignment action is audited

Each assignment, binding, release, consumption and void SHALL be recorded in the assignment's history and in the activity log, with its source:
- the sales call, for the agent;
- the staff user, for staff.

The objection reason given to the agent SHALL be kept. These records SHALL NOT store payment data.

#### Scenario: The agent assigns an offer
- **WHEN** the agent's tool records an assignment
- **THEN** an activity record names the sales call, the offer, the package and the objection reason
