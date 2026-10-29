# event-closure Specification

## Purpose

Defines when a customer may close an event, how setup data that was never paid for is retired when the event closes, what keeps an event open, and what is recorded.

## Requirements

### Requirement: Unpaid setup does not block closing
The system SHALL let the owner close an event whose RSVP service was chosen or approved but never paid, and SHALL retire that unpaid service in the same operation.

#### Scenario: Close with service awaiting approval
- **WHEN** the owner closes an event whose service awaits terms approval
- **THEN** the event is closed and the service is cancelled

#### Scenario: Close after a declined payment
- **WHEN** the owner closes an event whose only payment attempt was declined
- **THEN** the event is closed and the service is cancelled

#### Scenario: Close with no service
- **WHEN** the owner closes an event with no service
- **THEN** the event is closed

### Requirement: Closing and retiring are atomic
The system SHALL close the event and cancel its unpaid service together or not at all.

#### Scenario: Failure mid-operation
- **WHEN** any part of the close fails
- **THEN** neither the event status nor the service status changes

### Requirement: Money in flight or paid keeps the event open
The system SHALL refuse to close an event while its service has a payment in progress, under review, or succeeded (including test money), or a card hold, a charge or a billed result. The refusal SHALL tell the customer to contact support, without the word "קמפיין".

#### Scenario: Payment in progress
- **WHEN** the owner closes an event whose payment is in progress or under review
- **THEN** the close is refused with a message to contact support

#### Scenario: Paid service
- **WHEN** the owner closes an event whose service is paid
- **THEN** the close is refused and the event stays open

#### Scenario: Paid with test money
- **WHEN** the owner closes an event whose service was paid with test money
- **THEN** the close is refused; resetting a test run remains a staff action

### Requirement: Closing is authorized by the customer permission `events.close`
The system SHALL allow a close only to a user who may close the specific event under the customer permission system: the event's owner, or a member of the event's organization whose role holds `events.close`. The check SHALL run on the server for the specific event, on the user's own session. `events.close` SHALL be system-protected: only the organization's owner role holds it, and it cannot be granted to another role.

#### Scenario: The event's owner closes
- **WHEN** the event's owner requests the close
- **THEN** the close proceeds under the money rules of this specification

#### Scenario: Org member without the permission tries to close
- **WHEN** a signed-in member of the event's organization whose role does not hold `events.close` requests the close
- **THEN** the close is refused, nothing changes, and no close control is shown to them

#### Scenario: The permission cannot be delegated
- **WHEN** someone tries to grant `events.close` to a role other than the owner role
- **THEN** the grant is refused

### Requirement: Records are retained, not deleted
The system SHALL keep every record related to the retired service when an event closes: the service record as cancelled, approval and signature records, payment records including declined attempts, and guest data under the existing closed-event rules.

#### Scenario: Service with an approval and a declined payment
- **WHEN** an event with an approved service and a declined payment is closed
- **THEN** the approval record and the declined payment record still exist, and the service record shows cancelled

### Requirement: The close is audited
The system SHALL record, in the same operation, who closed the event and whether an unpaid service was retired, including the service's status before the close.

#### Scenario: Close that retires a service
- **WHEN** the owner closes an event and its unpaid service is cancelled
- **THEN** one audit record names the owner, the event, the service and its prior status
