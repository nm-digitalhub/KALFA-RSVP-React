# Spec Delta

## Purpose

Who may pause, revive, close and cancel an event's RSVP service (stored as the event's single campaign), through which
single transition, and the audit record each change leaves. The first start belongs to the server after a recorded
payment; a customer never changes the RSVP service's run state.

## ADDED Requirements

### Requirement: A run-state change is authorized by the staff member's key, not by transport or membership
Pausing, reviving, closing and cancelling an event's RSVP service SHALL be allowed exactly to a staff member who holds
that event action at the moment of the change. This SHALL hold for the web page and the console API alike. Console
membership SHALL NOT be required.

#### Scenario: Key holder, web
- **WHEN** a staff member holding the pause action pauses an event's running RSVP service from the event's campaign
  page
- **THEN** the RSVP service is paused

#### Scenario: Key holder, console API, not enrolled
- **WHEN** a staff member holding the pause action, who is not a console agent, pauses an event's running RSVP service
  through the console API
- **THEN** the RSVP service is paused

#### Scenario: Enrolled agent without the key
- **WHEN** an active console agent without the run-state actions asks to pause or revive an event's RSVP service
- **THEN** it is refused with the console API's forbidden answer, and the RSVP service is unchanged

### Requirement: The database re-checks the actor's key in the same transaction
The run-state transition SHALL re-verify that the named actor holds the key of that action on that channel. It SHALL
do so inside the database transaction that writes the status, before it reads the RSVP service. A server caller that
skips the application gate SHALL still be refused.

#### Scenario: Server code passes an actor without the key
- **WHEN** a server path invokes the transition naming a staff member who does not hold the key
- **THEN** the transition is refused, the status is unchanged and no audit row is written

### Requirement: Every run-state change writes its audit row atomically
Each successful pause, revival, close or cancel SHALL record a staff-only audit row in the same transaction as the
status change. The row SHALL carry who acted, the action, the channel (web, console API or cancellation request), the
RSVP service and the event; a cancel's row SHALL also carry the payment facts the cancel allowed. If the row cannot be
written, the status change SHALL NOT happen. A refused or no-op request SHALL write no row.

#### Scenario: Audit write fails
- **WHEN** the audit row cannot be written during a pause
- **THEN** the RSVP service stays running and the caller receives a failure

#### Scenario: Already in the target state
- **WHEN** a staff member pauses an RSVP service that is already paused
- **THEN** nothing changes and no audit row is written, and the caller receives the answer it receives today for a
  state that forbids the change

#### Scenario: Revival is distinguishable from the first start
- **WHEN** a paused RSVP service is revived
- **THEN** its audit record is a revival, distinct from the record of the first start after payment

#### Scenario: Cancel leaves a staff record
- **WHEN** a staff member cancels an RSVP service that has no financial commitment
- **THEN** a staff-only audit row names the staff member, the action and the channel, written in the same
  transaction as the cancel

#### Scenario: Cancel keeps its payment evidence
- **WHEN** a staff member cancels an RSVP service whose only collected payment was test money
- **THEN** the staff-only audit row records that a payment had succeeded and that it was test money only, whether or
  not an activity record that the customer can read is also written

### Requirement: Allowed transitions are fixed
Only these transitions SHALL be possible:
- pause: active → paused;
- revive: paused → active;
- close: active, paused, approved or scheduled → closed;
- cancel: draft, pending approval or approved → cancelled (no financial commitment).

A request for any other transition SHALL be refused without a write.

#### Scenario: Revive an RSVP service that never started
- **WHEN** a staff member asks to revive an RSVP service that is approved but never started
- **THEN** it is refused; the first start belongs to the recorded payment

### Requirement: Revival keeps every start guard
A revival SHALL be refused when the event date has passed, when the event is not active, or when the RSVP service's
package payment is not collected.

#### Scenario: Revive after the event
- **WHEN** a staff member revives a paused RSVP service whose event date has passed
- **THEN** it is refused with the past-event message, and nothing is written

### Requirement: Closing from a cancellation request checks every authority before money moves
When a staff member resolves a customer's cancellation request with a close, the system SHALL verify that the actor
may close the event's RSVP service. It SHALL do so before any refund or customer email is sent. The close SHALL be
accepted only while the request is pending and belongs to the same event. A resolution that closes nothing SHALL NOT
need the close authority.

#### Scenario: Billing staff without close authority
- **WHEN** a staff member who may resolve cancellations but may not close the RSVP service accepts a cancellation
- **THEN** it is refused before any refund or email, and the request stays pending

#### Scenario: Billing staff declines
- **WHEN** a staff member who may resolve cancellations but may not close the RSVP service declines a cancellation
- **THEN** the request is resolved as declined

#### Scenario: Request already resolved
- **WHEN** a close is attempted for a cancellation request that is no longer pending
- **THEN** it is refused without a write

#### Scenario: Request of another event
- **WHEN** a close names a pending cancellation request that belongs to another event
- **THEN** it is refused without a write

#### Scenario: Resolve retried after its close
- **WHEN** a resolve is retried after its close succeeded and its own record failed
- **THEN** the close answers that the service is already closed, no second audit row is written, and the resolve
  completes

### Requirement: The console API keeps its run-state contract
The console API's run-state endpoint SHALL keep its request body and its answers, so that its client needs no change:
- success with the new status;
- forbidden with the existing forbidden body;
- an unknown RSVP service as not found;
- a state that forbids the change as a conflict with the existing message.

#### Scenario: Already paused through the console
- **WHEN** the console asks to pause an RSVP service that is already paused
- **THEN** it receives the conflict status with the existing message, and nothing is written

#### Scenario: Unknown RSVP service
- **WHEN** the console names an RSVP service that does not exist
- **THEN** it receives the not-found status, and nothing is written

### Requirement: The campaign page offers exactly what the server allows
The event's campaign page SHALL show each run-state control exactly when the viewer holds that event action and the
RSVP service's state permits that transition. A viewer who holds a run-state action SHALL reach the page's staff
controls even without billing permissions.

#### Scenario: Billing staff without run-state
- **WHEN** a staff member with billing permissions but without the run-state actions opens a running RSVP service
- **THEN** no pause, close or cancel control is shown

#### Scenario: Run-state holder without billing
- **WHEN** a staff member holding only the run-state actions opens a running RSVP service
- **THEN** the pause and close controls are shown

### Requirement: A customer never changes the run state
No customer or organization member SHALL be able to start, pause, revive, close or cancel an event's RSVP service.
The first start SHALL happen only on the server after the package payment is recorded.

#### Scenario: Customer attempts a start
- **WHEN** a customer looks for a way to start an approved RSVP service
- **THEN** no page, action or API offers one; a paid package starts on the server
