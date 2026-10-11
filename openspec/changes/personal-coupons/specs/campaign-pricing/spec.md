## Purpose

The price agreed for one campaign: its list price, any discount, and the final price the customer approves and pays. It is held in one place, so the approved terms, the payment and every screen read the same price, and it is locked once the terms are approved.

## ADDED Requirements

### Requirement: One source of the campaign price

Each priced campaign SHALL have exactly one pricing record holding:
- the list price;
- the discount amount;
- the final price;
- the bound coupon assignment, if any;
- the time the price was locked.

The approved terms, the payment request and every screen SHALL read the price from this record.

#### Scenario: A package is chosen with an eligible offer
- **WHEN** a customer with an eligible personal offer chooses a package
- **THEN** the pricing record holds the package's list price, the discount and the final price, and names the assignment

#### Scenario: A package is chosen without an offer
- **WHEN** a customer without an offer chooses a package
- **THEN** the list price equals the final price and the discount is zero

### Requirement: The approved terms show the price as agreed

The package terms the customer approves SHALL state the final price. When a discount applies, they SHALL also state the list price and the discount.

#### Scenario: Approving discounted terms
- **WHEN** the customer approves the terms of a campaign with a discount
- **THEN** the approved document shows the list price, the discount and the final price, and the final price is what will be charged

### Requirement: The price is locked at approval

Approving the terms SHALL lock the pricing record. After that, the database SHALL refuse any change to its prices, its discount or its assignment, from any role.

#### Scenario: A server path tries to change an approved price
- **WHEN** any update tries to change the final price of a campaign whose terms were approved
- **THEN** the database refuses the update

### Requirement: The charged price equals the approved price

Opening a payment SHALL use the locked final price. It SHALL refuse to open one when the price is not locked, or does not equal the price in the approved terms.

#### Scenario: The price is not locked
- **WHEN** a payment is requested for a campaign whose pricing record is not locked
- **THEN** no payment session is opened

### Requirement: The discount is a lower price, not a deduction line

The payment request SHALL carry the final price as a positive amount. A discount SHALL NOT be sent to the clearing company or written to the ledger as a negative line.

#### Scenario: A discounted package is charged
- **WHEN** a payment session opens for a discounted campaign
- **THEN** the request carries one positive product line at the final price
