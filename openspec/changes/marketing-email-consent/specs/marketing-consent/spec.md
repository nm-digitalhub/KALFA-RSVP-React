# Spec Delta

## Purpose

Lets a KALFA customer grant and withdraw consent to KALFA marketing email, and keeps each change as evidence the customer cannot alter.

## ADDED Requirements

### Requirement: Signup offers an optional marketing-email consent
The signup form SHALL offer one marketing-email consent checkbox that is unchecked by default and is not required to create an account. The terms checkbox stays mandatory and separate.

#### Scenario: Signup without ticking the box
- **WHEN** a visitor signs up with the marketing box unchecked
- **THEN** the account is created and no consent is recorded for it

#### Scenario: Signup with the box ticked
- **WHEN** a visitor signs up with the marketing box ticked
- **THEN** the account is created and a grant is recorded for it, with source `signup`

#### Scenario: The box is never pre-checked
- **WHEN** the signup form is rendered
- **THEN** the marketing box is unchecked

### Requirement: The server owns the consent wording
The wording shown next to the box and the version recorded with a consent SHALL come from the server. A wording or version sent by the browser SHALL be ignored.

#### Scenario: Recorded wording matches what was rendered
- **WHEN** a grant is recorded
- **THEN** the record holds the exact wording and version the server rendered for that form

#### Scenario: Forged wording is ignored
- **WHEN** a signup request carries its own wording or version field
- **THEN** the recorded wording and version are the server's, not the request's

### Requirement: A duplicate signup records nothing
A signup for an email address that already has an account SHALL NOT record any consent.

#### Scenario: Existing address signs up again with the box ticked
- **WHEN** a signup is submitted for an address that already has an account
- **THEN** no consent row is written for any account

### Requirement: Customers can grant and withdraw consent in settings
A signed-in customer SHALL be able to see whether they consent to marketing email, and grant or withdraw it from the settings page. Each change SHALL be recorded with source `settings`.

#### Scenario: Withdraw from settings
- **WHEN** a consenting customer turns marketing email off in settings
- **THEN** a withdrawal is recorded and the settings page shows the consent as off

#### Scenario: Grant from settings
- **WHEN** a customer without consent turns marketing email on in settings
- **THEN** a grant is recorded with the current server wording and version

#### Scenario: No change, no record
- **WHEN** a customer saves settings without changing the marketing setting
- **THEN** no consent row is written

### Requirement: Consent records are append-only evidence
Each grant or withdrawal SHALL be a new record holding the customer id, the email address at the time, the action, the source, the wording and version (for grants), the client IP when known, the user agent when known, and the time. No user or API role SHALL be able to insert, change or delete a record.

#### Scenario: A customer tries to edit their record through the Data API
- **WHEN** a signed-in customer sends an update or delete for a consent record
- **THEN** the database refuses it

#### Scenario: A customer tries to insert a record through the Data API
- **WHEN** a signed-in customer sends an insert to the consent records
- **THEN** the database refuses it

#### Scenario: Current consent is the latest record
- **WHEN** a customer has a grant followed by a withdrawal
- **THEN** their current consent is "withdrawn"

### Requirement: The recorded IP is the socket address
The IP recorded with a consent SHALL be the address the public proxy saw on the connection, and SHALL be stored as unknown when that value is missing or is not a literal IP address. A client-supplied forwarding header SHALL NOT be used.

#### Scenario: A forged X-Forwarded-For header
- **WHEN** a signup carries an X-Forwarded-For header with an arbitrary address
- **THEN** the recorded IP is not that address

### Requirement: Consent records outlive the account
Deleting a customer account SHALL NOT delete that customer's consent records. Their email address and history SHALL remain.

#### Scenario: Account deleted after consenting
- **WHEN** an account with consent records is deleted
- **THEN** its consent records remain, no longer linked to an account, and the account deletion succeeds

### Requirement: Guests are never subject to marketing consent
Marketing consent SHALL apply only to customer accounts. No guest or contact of any event SHALL be given a consent record or reached by any marketing-consent behavior.

#### Scenario: A guest phone or email matches a customer
- **WHEN** a guest of some event has the same email address as a consenting customer
- **THEN** the guest row is never read or written by marketing-consent behavior
