## Purpose

How one personal benefit is assigned to one customer, valid for the packages its offer allows, by the sales agent or by staff; what proves the customer may use it; and how it is bound to, consumed by, or released from a campaign. A coupon is a price agreement, never a credit balance.

## ADDED Requirements

### Requirement: The server decides every discount from a defined offer

The system SHALL compute the discount and the resulting final price on the server, from an offer defined in the system's offer source. It SHALL NOT accept a discount, a percentage or a price from the sales agent or the browser. When no offer is defined, nothing SHALL be assigned.

#### Scenario: Agent asks for the configured discount
- **WHEN** the sales agent's discount tool is called during a call that is allowed an offer
- **THEN** the server returns the offer and, for each package the offer allows, its list price and the final price it computed
- **AND** the response contains no field the agent is expected to calculate

#### Scenario: A discount value is submitted
- **WHEN** a request carries a discount, a percentage, a price or a package chosen by the caller
- **THEN** the value is ignored and the defined offer decides

### Requirement: One assignment carries options for the allowed packages, and is used once

An assignment SHALL be one personal benefit. It SHALL carry one option for each package its offer allows, each with the package, its list price, the discount and the final price. Only the offer decides which packages are included. At most one option SHALL be bound to a campaign, and the assignment SHALL be used for at most one purchase.

#### Scenario: The benefit covers two packages
- **WHEN** the agent assigns a benefit whose offer allows the small and the large package
- **THEN** one assignment exists, with an option and a final price for each of the two packages

#### Scenario: The customer chooses a package outside the benefit
- **WHEN** a customer with a benefit chooses a package that has no option in it
- **THEN** no discount is applied to that package

#### Scenario: The customer switches package before approval
- **WHEN** a customer whose benefit is bound to an unapproved campaign changes the package to another allowed one
- **THEN** the pricing moves to the new package's option in one transaction, and no second assignment is created

### Requirement: An offer is promised only after it is saved

The system SHALL return an offer to the sales agent only after the assignment is durably recorded. When it cannot record the assignment, it SHALL return no offer.

#### Scenario: The assignment cannot be written
- **WHEN** the database refuses or fails to record the assignment
- **THEN** the tool returns that no offer is available and nothing is promised

### Requirement: A repeated request never creates a second assignment

Assigning an offer SHALL be idempotent per source:
- one per sales call for the agent, whatever package is discussed;
- one per staff request key for staff.

A repeated or retried request returns the existing assignment.

#### Scenario: The tool is called twice in one call
- **WHEN** the discount tool is called again during the same sales call
- **THEN** the same assignment is returned, with the same options and final prices, and no second assignment exists

### Requirement: Assigned terms are frozen

An assignment SHALL keep its own copy of the offer's terms:
- kind and value;
- the options: each package with its list price and final price at assignment time;
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
- **WHEN** an account verifies the phone the benefit was assigned to and chooses a package the benefit allows
- **THEN** the offer is applied and the assignment is tied to that account

### Requirement: Binding is atomic and exclusive

Binding an assignment SHALL, in one database transaction and after locking the campaign, its pricing record and the assignment in that order, write the chosen option's discount and final price into the campaign's pricing record and mark the assignment bound. A database constraint SHALL prevent the same assignment from being bound to two campaigns, or twice by concurrent requests.

#### Scenario: Two campaigns try to use one assignment
- **WHEN** two concurrent transactions bind the same assignment to two different campaigns
- **THEN** exactly one binding succeeds and the other is refused

### Requirement: Binding after approval requires fresh approval at the new price

Binding to a campaign whose pricing is locked SHALL run only through the defined supersede operation, which requires a fresh approval of the terms at the new final price before any payment. It SHALL be refused when the campaign has a package payment pending, in review or succeeded.

#### Scenario: A discount is given after the terms were approved
- **WHEN** a benefit is bound to an approved campaign that has no package payment
- **THEN** the customer must approve new terms at the discounted price, and the charge opens only on that newly approved price

### Requirement: Release is atomic and limited

Releasing a bound assignment SHALL, in one database transaction, restore the pricing record to the list price with no discount and no assignment, return the assignment to assigned (or to void if expired), and record the release in its history. It SHALL be refused when the pricing is locked or the campaign has a package payment pending, in review or succeeded.

#### Scenario: A campaign is abandoned before approval
- **WHEN** a bound assignment is released for an unapproved campaign with no package payment
- **THEN** the campaign's price returns to the list price, and the assignment can be bound again

#### Scenario: Release after approval
- **WHEN** release is requested for a campaign whose pricing is locked
- **THEN** the release is refused and nothing changes

### Requirement: Release runs only as part of moving the benefit

Release SHALL run only as the internal step of moving the benefit to another package or campaign. There SHALL be no staff release action and no abandonment timer; a benefit ends only by expiry, void or consumption.

#### Scenario: Staff look for a release action
- **WHEN** staff view a bound assignment whose campaign was abandoned before approval
- **THEN** no release action is offered; the benefit stays bound until it moves with the customer's next choice, is voided, or expires

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

#### Scenario: Staff void during an open payment
- **WHEN** staff try to void an assignment whose campaign has a pending package payment
- **THEN** the void is refused and the assignment is shown as held by that payment

### Requirement: A coupon is not credit

A coupon SHALL NOT create, consume or appear as credit balance. It SHALL NOT be written as a negative ledger line, nor counted in the ledger's `payment_operations.credit_applied`.

#### Scenario: A discounted package is paid
- **WHEN** a campaign with a bound assignment is paid
- **THEN** the payment's credit applied is zero and the customer's credit balance is unchanged

### Requirement: The customer can find and understand an offer

The package choice SHALL show, on every package the benefit allows, the list price, the discount and the final price. An account without a verified phone SHALL be invited to verify its phone without being told whether a benefit exists. The owner of a benefit SHALL be told when it has ended.

#### Scenario: An unverified account
- **WHEN** an account without a verified phone opens the package choice
- **THEN** it sees an invitation to verify its phone, and no information about any offer

#### Scenario: An expired offer
- **WHEN** the owner of an expired offer opens the package choice
- **THEN** the package shows its list price, and the screen says the offer has ended

### Requirement: Staff can follow every assignment

Staff with `manage_billing` SHALL see each assignment's source, target, options, state, bound campaign and chosen package, and that campaign's package payment outcome. They SHALL be able to assign and void an assignment.

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
- **THEN** an activity record names the sales call, the offer, its packages and the objection reason
