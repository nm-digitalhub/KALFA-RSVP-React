# Spec Delta

## Purpose

Records every message sent to a customer, sends it in the background with retries, and shows staff what each customer was told and whether it went out, whatever flow or channel the message comes from.

## ADDED Requirements

### Requirement: Every message of a covered flow is recorded before it is sent

A message to a customer from a covered flow SHALL be recorded before any attempt to send it, with its recipient, channel, purpose, the flow item it belongs to, its exact text, and its state.

#### Scenario: A cancellation is approved
- **WHEN** staff approve a cancellation request and the customer consented to SMS and has a phone
- **THEN** one e-mail record and one SMS record exist for that request, each holding the exact text that will be sent

#### Scenario: The record is written with the decision
- **WHEN** the cancellation's resolution is recorded
- **THEN** its message records are written in the same transaction, so either both exist or neither does

### Requirement: A message that cannot be sent is recorded as skipped

When a message cannot be sent at all, the system SHALL record it as skipped, with the reason, instead of leaving no trace.

#### Scenario: No SMS consent
- **WHEN** a cancellation is approved and the customer did not consent to SMS
- **THEN** an SMS record exists with the state "skipped" and the reason "no consent"

#### Scenario: No phone
- **WHEN** the customer consented to SMS but has no phone number
- **THEN** the SMS record is skipped with the reason "no phone"

### Requirement: One message per purpose per flow item

Recording the same message twice for the same flow item, purpose and channel SHALL NOT create a second record or a second send.

#### Scenario: A resolve is resumed
- **WHEN** a cancellation resolve is attempted again after an earlier attempt already recorded its messages
- **THEN** no new record is created and the customer is not messaged twice

### Requirement: Sending happens in the background

A recorded message SHALL be sent by a background process, not inside the staff action that produced it. A message whose send job was lost SHALL still be picked up.

#### Scenario: Approval does not wait for the e-mail
- **WHEN** staff approve a cancellation
- **THEN** the approval completes once the decision and the message records are saved, whether or not the e-mail has gone out yet

#### Scenario: A lost job
- **WHEN** a message is recorded but its send job never runs
- **THEN** a periodic sweep picks it up and sends it

### Requirement: Temporary failures are retried, refusals are not

A failed send SHALL be retried later only when the provider's own signal marks the failure as temporary. A refusal SHALL stop the message as failed. Retries SHALL stop after a bounded number of attempts.

#### Scenario: Provider temporarily unavailable
- **WHEN** a send fails with a failure the provider marks as temporary
- **THEN** the message is shown as waiting for another attempt, and it is attempted again later

#### Scenario: Provider refuses the recipient
- **WHEN** the provider refuses the message
- **THEN** the message is marked failed with the provider's code, and it is not retried automatically

#### Scenario: Retries run out
- **WHEN** a message has used every attempt
- **THEN** it is marked failed and staff are alerted

### Requirement: An unknown outcome is never sent again automatically

When a send may have reached the provider but its result was not recorded, the message SHALL be marked as unknown and SHALL NOT be sent again unless staff ask for it.

#### Scenario: Crash after a send
- **WHEN** a message was being sent and its result was never recorded
- **THEN** it is marked unknown, and no automatic resend happens

### Requirement: Retrying a message does not repeat the action behind it

Sending or resending a message SHALL NOT repeat the business action it reports, such as a refund.

#### Scenario: Cancellation e-mail retried
- **WHEN** the e-mail of an approved cancellation is retried
- **THEN** only the e-mail is sent again; no refund or other cancellation step runs

### Requirement: Approving a cancellation still needs a way to tell the customer

A cancellation SHALL NOT be approved when the e-mail channel is not configured, and this SHALL be checked before any money moves.

#### Scenario: E-mail not configured
- **WHEN** staff approve a cancellation while the e-mail channel is switched off or not set up
- **THEN** the approval is refused with nothing refunded and nothing recorded

### Requirement: Staff see a customer's communication

The admin customer page SHALL list every recorded message of that customer: when, channel, purpose, text, state, attempts and the last failure reason. It SHALL be shown only to staff allowed to see that customer's details, behind the same reason gate and access audit.

#### Scenario: Viewing a customer
- **WHEN** a permitted staff member opens a customer and gives an access reason
- **THEN** the communication section lists that customer's messages, newest first, and the access is audited

#### Scenario: Every state is shown
- **WHEN** a customer has messages that are waiting, sent, retrying, failed, unknown or skipped
- **THEN** each one shows its own state, and a skipped message shows its reason

### Requirement: Delivery is shown only as the provider reports it

A message SHALL be shown as delivered, bounced, complained or delayed only from the provider's own delivery report for that message, keeping the latest by the provider's event time. Without a report it SHALL be shown as accepted by the provider, never as delivered.

#### Scenario: E-mail accepted, no report yet
- **WHEN** the e-mail provider accepts a message and no delivery report has arrived
- **THEN** the screen shows it as handed to the provider, with the time and the provider's message id

#### Scenario: Delivery report arrives
- **WHEN** the provider reports that the message was delivered
- **THEN** the message shows as delivered, with the report's time

#### Scenario: Reports out of order
- **WHEN** a delivered report arrives after a later bounced report for the same message
- **THEN** the message keeps the bounced state

#### Scenario: A channel without reports
- **WHEN** an SMS is accepted by its provider
- **THEN** it shows as handed to the provider, and never as delivered

### Requirement: A flow's messages are shown and resent on that flow's page

A flow's own admin page SHALL show the messages of the item it displays. Staff with that page's permission SHALL be able to resend a failed or unknown message, which records a new attempt and an audit entry.

#### Scenario: Cancellation page
- **WHEN** staff open an approved cancellation request
- **THEN** its e-mail and SMS are listed with their state

#### Scenario: Resend an unknown SMS
- **WHEN** staff resend a message marked unknown
- **THEN** it is sent again once, and the resend and who asked for it are recorded

### Requirement: Personal data stays on the server

Message records SHALL be readable only on the server, behind staff permissions. Background jobs and logs SHALL carry message ids only, never addresses, phone numbers or texts.

#### Scenario: A browser asks for the table
- **WHEN** any signed-in or anonymous client queries the message records directly
- **THEN** it receives nothing

#### Scenario: A send fails
- **WHEN** a send fails and is logged and alerted
- **THEN** the log line and the alert carry the message id and the provider's code, and no address, phone number or text
