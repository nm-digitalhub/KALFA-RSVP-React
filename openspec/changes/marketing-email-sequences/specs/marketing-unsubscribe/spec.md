# Spec Delta

## Purpose

Lets the recipient of a KALFA marketing email leave the marketing list from the email itself, without logging in, and records it as a withdrawal.

## ADDED Requirements

### Requirement: One-click unsubscribe from the mail client
Each marketing email SHALL carry `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers pointing at an HTTPS endpoint that withdraws consent on a POST, with no login and no further step.

#### Scenario: The mail client's unsubscribe button
- **WHEN** the mail client POSTs `List-Unsubscribe=One-Click` to the header URL
- **THEN** a withdrawal is recorded for that customer and the endpoint answers success

### Requirement: The footer link asks before it acts
Opening the footer unsubscribe link SHALL show a confirm page and SHALL NOT withdraw consent by itself; the withdrawal SHALL happen only when the visitor confirms.

#### Scenario: A link scanner opens the link
- **WHEN** an email security scanner follows the footer link with GET
- **THEN** consent is not withdrawn

#### Scenario: The recipient confirms
- **WHEN** the recipient presses the confirm button on the page
- **THEN** a withdrawal is recorded and the page says they were removed

### Requirement: The token identifies one customer and cannot be forged
The unsubscribe link and header SHALL carry a token signed by the server that names exactly one customer, so the endpoint can be used without login. A missing, malformed or forged token SHALL withdraw nothing and SHALL return the same generic response.

#### Scenario: Forged token
- **WHEN** a request carries a token not signed by the server
- **THEN** nothing is recorded, the response does not reveal whether any customer exists, and the page tells the visitor how to unsubscribe another way instead of claiming success

#### Scenario: A link from before a key rotation
- **WHEN** a recipient uses an unsubscribe link signed with a key that has since been rotated
- **THEN** the token still verifies and the withdrawal is recorded

### Requirement: An unsubscribe reaches the provider
An unsubscribe SHALL be recorded as a withdrawal with source `email_unsubscribe`, and the customer's provider contact SHALL then be set unsubscribed.

#### Scenario: Recorded and synced
- **WHEN** a recipient unsubscribes from an email
- **THEN** the consent ledger records the withdrawal and the provider contact becomes unsubscribed

### Requirement: Repeated unsubscribes are harmless
Unsubscribing again, or unsubscribing a customer who no longer consents, SHALL record nothing new and SHALL answer success.

#### Scenario: Second click
- **WHEN** a recipient who already unsubscribed uses the link again
- **THEN** no new record is written and the page says they are not on the list
