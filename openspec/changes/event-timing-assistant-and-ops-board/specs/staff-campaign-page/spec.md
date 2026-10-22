# Spec Delta

## Purpose
How KALFA staff view and operate one event's service, on a staff page separate from the customer's. Both pages read the same records and write through the same operations.

## ADDED Requirements

### Requirement: Staff use a staff page, not the customer page
The system SHALL give staff who hold "manage billing" a page for one service inside the admin area. Every staff link to a service SHALL lead to it. The customer page SHALL contain no staff controls.

#### Scenario: Staff follow a link from the admin area
- **WHEN** a staff member opens a service from the campaign list, the staff event page, a cancellation request or the payments review list
- **THEN** the staff page of that service opens inside the admin area

#### Scenario: Old customer link
- **WHEN** a staff member who cannot access the event as a customer opens the customer page of a service
- **THEN** they are redirected to the staff page of that service

#### Scenario: Owner on the customer page
- **WHEN** the event owner opens the customer page
- **THEN** no staff control is shown

### Requirement: Staff see the payment state as it is
The system SHALL show staff the same payment state of a service as its customer sees, computed by the same rule.

#### Scenario: Paid service
- **WHEN** a staff member opens a service whose package payment is recorded
- **THEN** the page shows it as paid and offers no payment link

### Requirement: Staff see only the controls they may use
The system SHALL show a staff member only the controls their permissions allow. Pause, close, cancel and restart SHALL require the run-state permission. Owner actions (manual sends, payment, guests) SHALL NOT appear on the staff page.

#### Scenario: Billing clerk
- **WHEN** a staff member with "manage billing" and without the run-state permission opens a running service
- **THEN** no pause, close, cancel or restart control is shown

#### Scenario: Run-state holder
- **WHEN** a staff member with both permissions opens a running service
- **THEN** pause and close are shown, and using them changes the service

#### Scenario: Owner actions
- **WHEN** any staff member opens the staff page
- **THEN** no gift, event-day or thank-you send control and no customer link is shown

### Requirement: Staff may restart only a paused service
The system SHALL let a staff member with the run-state permission restart a paused service, under the same event checks as any start. Staff SHALL NOT start a service that was never running.

#### Scenario: Restart a paused service
- **WHEN** a run-state holder restarts a paused service of an active, future event
- **THEN** the service is running again and the restart is recorded with the staff member

#### Scenario: Approved, never started
- **WHEN** the service is approved but not running
- **THEN** no staff start control is shown

### Requirement: One source of truth for both pages
The system SHALL compute what a service's page shows (stage, payment, quota, cancellability) with one rule used by both pages, and SHALL write every change through the same operations the customer and console use. No record SHALL be written twice for one action.

#### Scenario: Thank-you time changed by staff
- **WHEN** a staff member changes the thank-you time of a service
- **THEN** the same record the owner edits changes once, and the change is recorded with the staff member's access reason

#### Scenario: Cancellability
- **WHEN** a service is paid and approved
- **THEN** both pages show it as not cancellable
