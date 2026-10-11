## Purpose

The price agreed for one campaign: its list price, any discount, and the final price the customer approves and pays. It is held in one place, so the approved terms, the payment and every screen read the same price. It is approved atomically against the version the terms were rendered from, and locked from that moment.

## ADDED Requirements

### Requirement: One source of the campaign price

Each priced campaign SHALL have exactly one pricing record holding:
- the list price;
- the discount amount;
- the final price, equal to the list price minus the discount;
- the bound coupon assignment, if any;
- a version that changes on every change of the record;
- the time the price was locked.

The approved terms, the payment request and every screen SHALL read the price from this record.

#### Scenario: A package is chosen with an eligible offer
- **WHEN** a customer with an eligible personal offer for that package chooses it
- **THEN** the pricing record holds the package's list price, the discount and the final price, and names the assignment

#### Scenario: A package is chosen without an offer
- **WHEN** a customer without an offer chooses a package
- **THEN** the list price equals the final price and the discount is zero

### Requirement: Approval is atomic and bound to the rendered version

The terms document SHALL be rendered from one version of the pricing record. Approving it SHALL, in one database transaction:
- confirm that this version is still current and the campaign is still awaiting approval;
- store the signed agreement;
- approve the campaign;
- lock the price.

When the version is no longer current, or the campaign is no longer awaiting approval, nothing SHALL be stored and the approval SHALL be refused.

#### Scenario: The price changes while the customer reads the terms
- **WHEN** the pricing record changes after the terms document was rendered and before the customer approves
- **THEN** the approval is refused, no agreement is stored, and the customer is shown terms rendered from the current price

#### Scenario: Two approvals race
- **WHEN** two approval requests for the same campaign run at the same time
- **THEN** exactly one stores an agreement and approves; the other is refused and stores nothing

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

#### Scenario: A server path tries to change an approved price
- **WHEN** any update tries to change the final price of a locked record
- **THEN** the database refuses the update

#### Scenario: A server path tries to unlock or move the record
- **WHEN** an update clears the lock time or changes the campaign of a locked record
- **THEN** the database refuses the update

#### Scenario: A locked record is deleted
- **WHEN** a delete reaches a locked record, directly or through its campaign
- **THEN** the database refuses the delete

### Requirement: The charged price equals the approved price

Opening a payment SHALL use the locked final price. It SHALL refuse to open one when the price is not locked.

#### Scenario: The price is not locked
- **WHEN** a payment is requested for a campaign whose pricing record is not locked
- **THEN** no payment session is opened

### Requirement: The discount is a lower price, not a deduction line

The payment request SHALL carry the final price as a positive amount. A discount SHALL NOT be sent to the clearing company or written to the ledger as a negative line.

#### Scenario: A discounted package is charged
- **WHEN** a payment session opens for a discounted campaign
- **THEN** the request carries one positive product line at the final price

### Requirement: The two copies of the price stay equal until the old one is removed

While `campaigns.package_price` exists, the database SHALL keep it equal to the pricing record's final price, in whichever direction the current phase writes. The old column SHALL be removed only after no reader uses it, and a check finds no campaign whose two copies differ and no approved campaign whose succeeded payment differs from its approved price.

#### Scenario: Old code sets a price during the transition
- **WHEN** code that still writes `campaigns.package_price` sets the price of an unlocked campaign without an assignment
- **THEN** the pricing record holds the same price

#### Scenario: The check finds a difference
- **WHEN** the equality check returns any campaign
- **THEN** the old column is not removed
