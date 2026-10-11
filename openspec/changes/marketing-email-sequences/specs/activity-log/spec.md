# Spec Delta

## Purpose

Keeps the activity log a trustworthy record of what happened to each event: every setup step is recorded, and nobody can write to the history of an event they cannot access.

## ADDED Requirements

### Requirement: Every setup step is recorded
Approving the package terms, signing the agreement and opening the payment page SHALL each write an activity-log entry for the event after the step succeeds, carrying ids only and no personal data.

#### Scenario: Terms approved
- **WHEN** the owner approves the package terms successfully
- **THEN** one `campaign.terms_approved` entry is recorded for the event

#### Scenario: Step fails
- **WHEN** opening the payment page fails
- **THEN** no `campaign.payment_started` entry is recorded

### Requirement: Only users with access may write an event's history
A signed-in user SHALL be able to add an activity-log entry for an event only when they own it, hold a permission through their organization that lets them change the event (edit on events, guests, contacts or campaigns, or manage on campaigns), or are platform staff; view-only access SHALL NOT be enough. Entries without an event SHALL remain allowed for the user themselves.

#### Scenario: A stranger writes to another owner's event
- **WHEN** a signed-in customer inserts an entry for an event they have no access to
- **THEN** the database refuses it

#### Scenario: A view-only organization member
- **WHEN** an organization member who may only view the event inserts an entry for it
- **THEN** the database refuses it

#### Scenario: Staff action on a customer event
- **WHEN** a platform staff member's admin action records an entry on a customer's event
- **THEN** the entry is accepted

### Requirement: The log's time is set by the server
An activity-log entry's time and id SHALL be set by the database; a signed-in user SHALL NOT be able to supply them, nor update or delete an entry.

#### Scenario: A client sends its own time
- **WHEN** a signed-in user inserts an entry that names a creation time
- **THEN** the database refuses it

#### Scenario: A normal entry
- **WHEN** the application records an entry with the event, the user, the action and its details
- **THEN** it is accepted and its time is the server's
