# Spec Delta

## Purpose

Keeps the email provider's marketing contact list in line with recorded customer consent, and brings unsubscribes and complaints from the provider back into the consent record.

## ADDED Requirements

### Requirement: Only confirmed addresses are subscribed
A customer SHALL be added to the provider's marketing list as subscribed only when their latest consent is a grant and their email address is confirmed.

#### Scenario: Consent given, address not yet confirmed
- **WHEN** a customer ticked the box at signup and has not confirmed their email
- **THEN** the provider has no subscribed contact for that address

#### Scenario: Address confirmed after consenting
- **WHEN** that customer confirms their email
- **THEN** the provider gets a subscribed contact for that address

### Requirement: Withdrawals reach the provider
When a customer's latest consent becomes a withdrawal, the provider SHALL mark that address as unsubscribed.

#### Scenario: Withdraw in settings
- **WHEN** a subscribed customer withdraws in settings
- **THEN** the provider marks the address unsubscribed

### Requirement: Sync failures are retried and never block the customer
A failed provider call SHALL NOT fail the signup, confirmation or settings action that caused it, and SHALL be retried until the provider reflects the latest consent.

#### Scenario: Provider unavailable during a settings change
- **WHEN** the provider call fails while a customer withdraws
- **THEN** the withdrawal is recorded, the customer sees success, and a later retry marks the address unsubscribed

### Requirement: Account email changes move the subscription
When a consenting customer's confirmed email address changes, the old address SHALL be unsubscribed and the new one subscribed.

#### Scenario: Email change confirmed
- **WHEN** a consenting customer confirms a new email address
- **THEN** the provider unsubscribes the old address and subscribes the new one

### Requirement: Account deletion unsubscribes the address
When a customer account is deleted, its address SHALL be removed from or unsubscribed in the provider's list.

#### Scenario: Consenting account deleted
- **WHEN** an account whose latest consent is a grant is deleted
- **THEN** the provider no longer treats the address as subscribed

### Requirement: Provider unsubscribes are recorded as withdrawals
An unsubscribe reported by the provider for a customer address SHALL be recorded as a withdrawal with source `provider_unsubscribe`, once per provider event.

#### Scenario: Customer clicks unsubscribe in an email
- **WHEN** the provider reports the contact as unsubscribed
- **THEN** a withdrawal is recorded for that customer

#### Scenario: The same event is delivered twice
- **WHEN** the provider delivers the same unsubscribe event again
- **THEN** no second withdrawal is recorded

#### Scenario: An out-of-date event arrives late
- **WHEN** an unsubscribe event older than the customer's latest consent change arrives
- **THEN** the customer's current consent does not change

### Requirement: Spam complaints are recorded as withdrawals
A spam complaint reported by the provider for a customer address SHALL be recorded as a withdrawal with source `provider_complaint`.

#### Scenario: Customer marks a marketing email as spam
- **WHEN** the provider reports a complaint for that address
- **THEN** a withdrawal is recorded and the address is unsubscribed at the provider

### Requirement: Provider events are verified before use
Provider webhook events SHALL be accepted only with a valid signature, and SHALL be stored before they are processed.

#### Scenario: Unsigned contact event
- **WHEN** a contact event arrives without a valid signature
- **THEN** it is rejected and no consent changes

### Requirement: Only customer accounts are synced
The sync SHALL read customer accounts only, and SHALL NOT read guests or event contacts.

#### Scenario: Sync run over all consenting customers
- **WHEN** a retry sweep runs
- **THEN** every address it sends belongs to a customer account
