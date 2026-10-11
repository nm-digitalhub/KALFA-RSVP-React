# Spec Delta

## Purpose

Decides which KALFA marketing email a consenting customer receives and when, and the checks every send must pass.

## ADDED Requirements

### Requirement: Only consenting, confirmed customers receive marketing email
A marketing email SHALL be sent only to a customer account whose latest consent is a grant and whose email address is confirmed, both checked at send time. Guests and event contacts SHALL never receive one.

#### Scenario: Consent withdrawn after the email was scheduled
- **WHEN** a customer withdraws consent before a due email is sent
- **THEN** the email is not sent

#### Scenario: Address not confirmed
- **WHEN** a customer granted consent but has not confirmed their email
- **THEN** no marketing email is sent to them

### Requirement: Every marketing email carries the legal markings
Every marketing email SHALL open its subject line and its body with "פרסומת", SHALL carry the advertiser's legal name, address, phone and email from the company settings, and SHALL carry a working unsubscribe link and one-click unsubscribe headers.

#### Scenario: Rendered welcome email
- **WHEN** the welcome email is rendered for a customer
- **THEN** its subject starts with "פרסומת", its body starts with "פרסומת", and its footer shows the configured company details and an unsubscribe link

#### Scenario: Missing company details
- **WHEN** the company legal name or address is not configured
- **THEN** no marketing email is sent

### Requirement: Welcome email after a signup consent
A customer who granted consent at signup SHALL receive the welcome email once, after confirming their email address.

#### Scenario: New customer confirms
- **WHEN** a customer who ticked the box at signup confirms their email
- **THEN** the welcome email is sent once, by the first sweep (every 15 minutes) inside an allowed send window

#### Scenario: Consent granted later in settings
- **WHEN** an existing customer turns marketing email on in settings
- **THEN** no welcome email is sent

### Requirement: Setup reminder for a stalled event
A consenting customer whose event setup is not finished SHALL receive one reminder per event once 24 hours pass without setup progress, naming the event and its current setup step. No reminder SHALL be sent for an event created more than 14 days ago, a past event, or an event whose setup is finished.

#### Scenario: Setup stalled for a day
- **WHEN** a consenting customer's event has had no owner setup action for 24 hours and its setup is not finished
- **THEN** one reminder is sent for that event, naming its current step

#### Scenario: Only a background update since the last setup action
- **WHEN** the event's last owner setup action was 30 hours ago and a background process updated the event 2 hours ago
- **THEN** the reminder is due

#### Scenario: Setup finished before the reminder
- **WHEN** the event's setup is finished before the reminder is due
- **THEN** no reminder is sent

### Requirement: How-it-works email
A consenting customer SHALL receive the how-it-works email once, at least 3 days after their welcome email, unless they already have an event whose setup is finished.

#### Scenario: Three days after the welcome
- **WHEN** 3 days have passed since a customer's welcome email was handed to the provider and none of their events has finished setup
- **THEN** the how-it-works email is sent once

#### Scenario: Welcome never handed off
- **WHEN** a customer's welcome email failed or has an unknown outcome
- **THEN** no how-it-works email is sent on its account

### Requirement: No email is sent twice
Each template SHALL be sent at most once per customer, and the setup reminder at most once per event, even when the sweep runs concurrently or a send is retried.

#### Scenario: Two sweeps overlap
- **WHEN** two sweep runs find the same due email
- **THEN** exactly one email is sent

### Requirement: Sends respect the Israeli calendar
Marketing email SHALL be sent only Sunday to Thursday 09:00–20:30 and Friday 09:00–12:00 Israel time, never during Shabbat or a festival, and never on Yom Kippur, Yom HaZikaron, Yom HaShoah or Tisha B'Av. A due email outside the window SHALL wait for the next allowed time.

#### Scenario: Due on Saturday
- **WHEN** an email becomes due on Saturday afternoon
- **THEN** it is sent after Shabbat ends, at the next allowed time

#### Scenario: Due on Yom HaZikaron
- **WHEN** an email becomes due on Yom HaZikaron
- **THEN** it is not sent that day

### Requirement: An uncertain send is never repeated
A send SHALL be recorded as failed only when the provider definitely refused it. A transport failure, a server error or an idempotency conflict SHALL be recorded as unknown outcome, SHALL NOT be retried, and SHALL be resolved only by a later provider event for that send.

#### Scenario: Provider server error
- **WHEN** the provider answers the send with a 5xx error
- **THEN** the send is unknown outcome, not failed, and no second email is sent

#### Scenario: Timeout after the request left
- **WHEN** the provider call times out after the request was sent
- **THEN** the send is unknown outcome, no second email is sent, and a later delivery event marks it delivered

### Requirement: Provider results apply in order
A provider event SHALL update a send only if it is newer than the last event applied, and SHALL never move a send backwards; an event that arrives before the send's provider id was saved SHALL still find its send. The sender and the event processing SHALL each update a send in one atomic conditional write, so neither overwrites the other.

#### Scenario: Delivery recorded before the send call returns
- **WHEN** a delivery event marks a send delivered and the send call returns afterwards
- **THEN** the send stays delivered

#### Scenario: An older event processed late
- **WHEN** a delivered event was applied and an older accepted-type event is processed afterwards
- **THEN** the send stays delivered

### Requirement: Marketing email goes through Resend only
Marketing email SHALL be sent only while the configured email provider is Resend.

#### Scenario: SMTP configured
- **WHEN** the configured provider is SMTP
- **THEN** no marketing email is sent and the readiness check shows sending blocked

### Requirement: No reminder without a recorded setup action
A setup reminder SHALL be sent only when an owner setup action is recorded for the event; with no record, no reminder SHALL be sent.

#### Scenario: Setup action not recorded
- **WHEN** an event has no recorded owner setup action
- **THEN** no reminder is sent for it

### Requirement: A failing readiness gate stops sending while switched on
Sending SHALL stop whenever a technical readiness gate fails or cannot be verified, even while the sending switch is on, and a template whose current version is not approved SHALL not be sent.

#### Scenario: Secret removed while sending is on
- **WHEN** the webhook secret is removed while sending is on
- **THEN** no marketing email is sent until it is restored

### Requirement: A separate switch for sending
Marketing email SHALL be sent only while the sending switch is on, independently of the consent switch.

#### Scenario: Consent on, sending off
- **WHEN** consent collection is on and sending is off
- **THEN** customers can consent and no marketing email is sent
