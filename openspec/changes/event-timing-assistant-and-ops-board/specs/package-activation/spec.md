# Spec Delta

## Purpose
How a package payment recorded by the server starts the event's service. It covers every payment path, works without the buyer's browser, happens exactly once, and never restarts a service that staff stopped.

## ADDED Requirements

### Requirement: A recorded payment starts the service without the buyer's browser
The system SHALL start the service of a campaign whose terms are approved once the server records its package payment as succeeded, whichever path reported the payment: the buyer's browser, the payment provider's notification, or an inline charge. It SHALL NOT depend on the buyer's browser staying open or returning.

#### Scenario: Provider notification only
- **WHEN** the payment provider notifies the server of a succeeded package payment and the buyer's browser never calls back
- **THEN** the payment is recorded and the service is running shortly afterwards, with one activation record

#### Scenario: Browser stays to the end
- **WHEN** the buyer's browser completes the payment flow
- **THEN** the service is running when the buyer lands on the event page

#### Scenario: Browser returns after the notification
- **WHEN** the provider's notification is processed first and the buyer's browser calls back later
- **THEN** the service is running and there is exactly one activation record

### Requirement: Activation happens exactly once
The system SHALL activate a campaign at most once per recorded payment, however many times the payment is reported or the activation is attempted, and SHALL complete a partly finished activation on a later attempt.

#### Scenario: The same notification arrives twice
- **WHEN** the provider sends the same payment notification twice
- **THEN** one payment is recorded, one activation is recorded, and the default thank-you time is set once

#### Scenario: Interrupted after the status change
- **WHEN** an attempt set the service running but stopped before recording the activation or setting the default thank-you time
- **THEN** the next attempt records the activation and sets the thank-you time without changing anything else

### Requirement: Activation never overrides a later staff decision
The system SHALL start a service only from the state "terms approved, waiting for payment". It SHALL NOT start a service that is paused, closed or cancelled. The state check SHALL be part of the same database update.

#### Scenario: Staff paused the service before a delayed attempt
- **WHEN** an activation attempt runs after staff paused the service
- **THEN** the service stays paused and the attempt ends without an error alert

#### Scenario: Event no longer eligible
- **WHEN** the event's date has passed or the event is not active at the time of the attempt
- **THEN** the service is not started and staff are alerted

### Requirement: Failures are retried and then escalated
The system SHALL retry a failed activation automatically, at most five attempts in total, and SHALL alert staff only when the last attempt fails. A paid campaign that is still waiting for activation after the retries, or whose activation was never queued, SHALL be found by the periodic payment check and attempted again.

#### Scenario: Payment record unreadable for a moment
- **WHEN** the first attempt cannot read the payment record and a later attempt can
- **THEN** the service starts on the later attempt and no alert is sent

#### Scenario: Every attempt fails
- **WHEN** all five attempts fail
- **THEN** staff receive one alert naming the campaign and the event

#### Scenario: The activation was never queued
- **WHEN** a payment is recorded but its activation could not be queued
- **THEN** the periodic payment check queues it, and the service starts

### Requirement: The customer is never asked to activate
The system SHALL NOT show the customer an "activate" or "start" action, or a "not started" state, for a paid package. While a paid service is being started the customer SHALL see that the service is being started.

#### Scenario: Paid, activation still pending
- **WHEN** the owner opens the event while the activation is still being attempted
- **THEN** the owner sees that the service is being started, with no button to start it
