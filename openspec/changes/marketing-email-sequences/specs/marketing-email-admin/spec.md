# Spec Delta

## Purpose

Gives KALFA staff one admin page to see what marketing email will go out, why each email was sent or stopped, and to control and test sending.

## ADDED Requirements

### Requirement: An admin page under campaigns and sending
The admin menu SHALL have a "מיילים שיווקיים" page in the "קמפיינים ושליחה" group, visible only to staff who may view customer data.

#### Scenario: Staff without the permission
- **WHEN** a staff member without permission to view customer data opens the page
- **THEN** access is refused on the server and the menu does not show it

### Requirement: The overview states the sending status in words
The overview SHALL show whether sending is on or off (and who turned it off and when, from the activity log), when the next allowed send window starts, the number of current candidates, sends in the selected period, failures needing review, and a readiness warning only when something blocks enabling. Every status SHALL be written in text, not color alone.

#### Scenario: Sending off at night
- **WHEN** sending is off and it is 23:00 on a weekday
- **THEN** the overview says sending is off and that the next window starts the next day at 09:00

### Requirement: Candidates are a forecast, not a promise
Candidate counts and lists SHALL be labelled as a forecast, because consent, event state and the send window are checked again at send time.

#### Scenario: A candidate withdraws
- **WHEN** a listed candidate withdraws consent before the next sweep
- **THEN** no email is sent to them and the list no longer shows them

### Requirement: Each automatic email has a details view
For each of the three emails the page SHALL show a desktop and mobile preview rendered by the same function that sends it, with subject and footer, the exact send condition in plain words, who it goes to, what stops it, and the template version in use. Templates stay in code; the page shows them and does not edit them.

#### Scenario: Opening the setup reminder
- **WHEN** staff open the setup reminder
- **THEN** they see its preview, that it goes once per event 24 hours after setup stops within 14 days of creation, and what stops it

### Requirement: Test send only to the caller's own verified address
Staff with the settings permission SHALL be able to send any of the three emails to their own confirmed address only. A test send SHALL carry real unsubscribe headers for the caller and SHALL write no send-ledger row.

#### Scenario: Test send
- **WHEN** a staff member sends a test of the welcome email
- **THEN** it arrives at their own confirmed address and no customer's send history changes

#### Scenario: No other recipient
- **WHEN** a test-send request names another address
- **THEN** the address is ignored and the email goes to the caller only

### Requirement: Recipients view with consent and eligibility
The page SHALL list customers with their current consent, consent time and source, address confirmation, provider sync state, their marketing emails, and why they are or are not eligible for the next email. Staff SHALL NOT be able to grant consent on a customer's behalf.

#### Scenario: Opening a customer
- **WHEN** staff open a customer in the recipients list
- **THEN** a side panel shows their consent history, sync state, sent emails and next-email eligibility, with no control that grants consent

### Requirement: Send history with explicit states
Each send SHALL show one of: pending, accepted by the provider, delivered, failed, not sent (with its reason), or unknown outcome; and a timeline of eligibility, claim, hand-off to the provider and the provider's updates, each with its recorded time. A step with no recorded time SHALL be shown as not recorded, never estimated. No resend control SHALL exist.

#### Scenario: A send left unfinished
- **WHEN** a send was claimed and no provider result was recorded within 15 minutes
- **THEN** it shows as unknown outcome, not as failed or sent

### Requirement: Readiness is computed and approvals are recorded
Technical readiness gates SHALL be evaluated live on every view, never stored as ticks. Human approvals SHALL be append-only records naming the approver, the time and the approved template version, and a template approval SHALL count only for the version currently in code.

#### Scenario: Webhook secret missing
- **WHEN** the webhook subscriptions are correct but the webhook secret is not set
- **THEN** the intake gate is open, because events would be acknowledged and not stored

#### Scenario: A check cannot run
- **WHEN** the provider cannot be reached during the readiness check
- **THEN** that gate is shown as unverifiable, not passed, and enabling is refused

#### Scenario: Approval recorded
- **WHEN** the owner approves the welcome email
- **THEN** a record names the owner, the time and the welcome email's current version

### Requirement: Enabling is an explicit owner action behind the readiness check
Turning sending on SHALL be available only to the platform owner, only while every gate passes, and SHALL show the current candidate count and next sweep time before confirming. Turning sending off SHALL be available to the owner at any time. Both SHALL be recorded in the activity log. The consent switch and the sending switch SHALL be shown separately.

#### Scenario: A gate is open
- **WHEN** the company address is still unconfirmed in the readiness check
- **THEN** the enable control is unavailable and the check links to the company settings

#### Scenario: A setting changes after approval
- **WHEN** the unsubscribe keys are removed after all gates once passed
- **THEN** the readiness check shows that gate open and enabling is refused

#### Scenario: A template changes after approval
- **WHEN** a template's version in code changes after it was approved
- **THEN** its approval gate is open again until the new version is approved

#### Scenario: Owner enables
- **WHEN** the owner confirms enabling with all gates done
- **THEN** sending turns on and the action is recorded in the activity log
