## Purpose

The price agreed for one campaign: its list price, any discount, and the final price the customer approves and pays. It is held in one place, so the approved terms, the payment and every screen read the same price. It is approved atomically against the version the terms were rendered from, and locked from that moment.

## ADDED Requirements

### Requirement: One source of the campaign price

Each priced campaign SHALL have exactly one CURRENT pricing record; superseded records are kept as immutable history. The current record holds:
- the list price;
- the discount amount;
- the final price, equal to the list price minus the discount;
- the bound coupon assignment, if any;
- a version that changes on every change of the record;
- the time the price was locked.

The approved terms, the payment request and every screen SHALL read the price from the current record.

#### Scenario: A package is chosen with an eligible offer
- **WHEN** a customer with an eligible personal offer for that package chooses it
- **THEN** the pricing record holds the package's list price, the discount and the final price, and names the assignment

#### Scenario: A package is chosen without an offer
- **WHEN** a customer without an offer chooses a package
- **THEN** the list price equals the final price and the discount is zero

### Requirement: Approval is atomic and bound to the rendered record and version

The terms document SHALL be rendered from one version of one pricing record. Approving it SHALL, in one database transaction, confirm that this exact record is still the campaign's current one and its version unchanged, and that the campaign is awaiting approval; then store the signed agreement with the record it was rendered from, approve the campaign and lock the price. Otherwise nothing SHALL be stored and the approval SHALL be refused.

#### Scenario: The price changes while the customer reads the terms
- **WHEN** the pricing record changes after the terms document was rendered and before the customer approves
- **THEN** the approval is refused, no agreement is stored, and the customer is shown terms rendered from the current price

#### Scenario: A document from a superseded record carries a matching version number
- **WHEN** an approval names a superseded pricing record whose version number equals the current record's
- **THEN** the approval is refused, because the record itself is no longer current

#### Scenario: Two approvals race
- **WHEN** two approval requests for the same campaign run at the same time
- **THEN** exactly one stores an agreement and approves; the other is refused and stores nothing

### Requirement: Price operations lock rows in one order

Every operation that reads and then changes a campaign's price SHALL lock the campaign, then its pricing record, then any coupon assignment, before its checks.

#### Scenario: Approval and a price change at the same time
- **WHEN** an approval and a binding run concurrently on one campaign
- **THEN** one waits for the other, and the approval checks the version only after holding both locks

### Requirement: An unknown approval outcome is resolved before cleanup

When the approval call's outcome is unknown, the server SHALL determine it from the stored agreement for that approval request id: an agreement found means approved; none found leaves the outcome unknown until that attempt can no longer commit. A rendered document SHALL be removed only when no agreement refers to it and the attempt that produced it is concluded.

#### Scenario: The answer is lost
- **WHEN** the approval call times out after the database committed it
- **THEN** the rendered document is kept, and the lookup by request id finds the stored agreement and reports the campaign approved

#### Scenario: The lookup finds nothing while the attempt may still commit
- **WHEN** the lookup by request id finds no agreement right after a timeout
- **THEN** the outcome stays unknown, the document is kept, and refusal is concluded only once the attempt can no longer commit

### Requirement: The approved terms show the price as agreed

The package terms the customer approves SHALL state the final price. When a discount applies, they SHALL also state the list price and the discount.

#### Scenario: Approving discounted terms
- **WHEN** the customer approves the terms of a campaign with a discount
- **THEN** the approved document shows the list price, the discount and the final price, and the final price is what will be charged

### Requirement: A locked price cannot be changed, unlocked, re-keyed or deleted

After the lock, the database SHALL refuse, from any role:
- any change to the prices, the discount or the assignment;
- clearing the lock time;
- changing which campaign the record belongs to;
- deleting the record, directly or by deleting its campaign.

The single exception SHALL be the one-way superseded mark set by the defined supersede operation; a superseded record SHALL refuse every further change.

#### Scenario: A server path tries to change an approved price
- **WHEN** any update tries to change the final price of a locked record
- **THEN** the database refuses the update

#### Scenario: A server path tries to unlock or move the record
- **WHEN** an update clears the lock time or changes the campaign of a locked record
- **THEN** the database refuses the update

#### Scenario: A locked record is deleted
- **WHEN** a delete reaches a locked record, directly or through its campaign
- **THEN** the database refuses the delete

### Requirement: Superseding opens a new pricing round without touching history

A locked price SHALL be replaced only by the defined supersede operation: in one transaction it creates a new current pricing record, marks the old one superseded, and returns the campaign to awaiting approval. It SHALL run only on the customer's own action and only while the campaign has no package payment pending, in review or succeeded. Each stored agreement SHALL reference the pricing record it was rendered from.

#### Scenario: The customer accepts a benefit after approving full-price terms
- **WHEN** a customer with approved, unpaid terms accepts an offered benefit
- **THEN** a new pricing record carries the discounted price, the old record is marked superseded and keeps its values, and the campaign awaits approval of the new terms

#### Scenario: A payment is already pending
- **WHEN** the supersede operation runs while the campaign has a pending package payment
- **THEN** it is refused and nothing changes

#### Scenario: A superseded record is edited
- **WHEN** any update reaches a superseded pricing record
- **THEN** the database refuses it

### Requirement: The charged price equals the approved price

Opening a payment SHALL, in the same transaction that records the pending payment, verify that the named pricing record is the campaign's current one and locked, that the amount equals it, and that any bound benefit is unexpired at that moment. It SHALL refuse otherwise.

#### Scenario: The price is not locked
- **WHEN** a payment is requested for a campaign whose pricing record is not locked
- **THEN** no payment session is opened

#### Scenario: The benefit expired before the session opened
- **WHEN** a payment is requested for a campaign whose bound benefit has expired
- **THEN** no session is opened, and the customer is offered new terms at the current price

### Requirement: A payment names its pricing record and settles by it

The pending payment SHALL record which pricing record it charges. Settlement, consumption and refunds SHALL read the price from that record — never from whichever record is current when they run — so a session opened in validity settles at its price even if the benefit expires, is voided or is superseded while it is open.

#### Scenario: The benefit expires while the session is open
- **WHEN** the benefit's expiry passes after the session opened in validity
- **THEN** the payment settles at the session's price and consumes the assignment

#### Scenario: A refund after a supersede
- **WHEN** a refund runs for a payment whose pricing record was later superseded
- **THEN** the refundable amount is computed from the record the payment named

### Requirement: The discount is a lower price, not a deduction line

The payment request SHALL carry the final price as a positive amount. A discount SHALL NOT be sent to the clearing company or written to the ledger as a negative line.

#### Scenario: A discounted package is charged
- **WHEN** a payment session opens for a discounted campaign
- **THEN** the request carries one positive product line at the final price

### Requirement: The two copies of the price stay equal until the old one is removed

While `campaigns.package_price` exists, the database SHALL keep it equal to the pricing record's final price, in whichever direction the current phase writes. The old column SHALL be removed only after no reader uses it, and a check finds no campaign whose two copies differ and no approved campaign whose succeeded payment differs from its approved price.

#### Scenario: Old code approves a campaign during the transition
- **WHEN** code that does not know the pricing record approves a campaign
- **THEN** the database locks that campaign's pricing record in the same transaction

#### Scenario: Old code sets a price during the transition
- **WHEN** code that still writes `campaigns.package_price` sets the price of an unlocked campaign without an assignment
- **THEN** the pricing record holds the same price

#### Scenario: The check finds a difference
- **WHEN** the equality check returns any campaign
- **THEN** the old column is not removed

### Requirement: Rollback to code without coupons closes once a discount exists

Returning to code that does not know the pricing record SHALL be allowed only while no campaign carries a coupon assignment. A query SHALL list the campaigns that block it.

#### Scenario: A discounted campaign exists
- **WHEN** a rollback to the previous code is considered and a campaign carries an assignment
- **THEN** the query lists that campaign and the rollback is not performed
