# Spec Delta

## Purpose

Defines what a customer sees for an event from its creation until the server confirms payment for the RSVP service, and how the product hands the customer from setup to managing the event.

## ADDED Requirements

### Requirement: Payment confirmed by the server ends setup
The system SHALL treat an event as in setup until the server's payment record shows the RSVP service paid in full, and as in management from then on. The browser, a URL parameter or a redirect from a payment provider SHALL NOT end setup on their own.

#### Scenario: Unpaid event is in setup
- **WHEN** an event has no service chosen, or a chosen service with no confirmed payment
- **THEN** the event is in setup

#### Scenario: Paid event is in management
- **WHEN** the server's payment record shows the service paid
- **THEN** the event is in management, whether or not outreach has started

#### Scenario: Provider return does not end setup
- **WHEN** the customer returns from the payment provider with a success parameter but the server has not recorded the payment
- **THEN** the event remains in setup and shows the payment as in progress

### Requirement: Owner of an event in setup sees only the setup flow
The system SHALL show the owner of an event in setup only the setup flow: no event management controls, no results, no close-request form and no separate edit form outside the flow.

#### Scenario: Owner opens the event page during setup
- **WHEN** the owner opens the event page of an event in setup
- **THEN** the owner is taken to the setup flow at the step the server computes

#### Scenario: Owner opens the results page by URL during setup
- **WHEN** the owner opens the service results page of an event in setup
- **THEN** the owner is taken to the setup flow

#### Scenario: Payment state cannot be read
- **WHEN** the server cannot read the payment record of the event
- **THEN** the screen states that the state is unavailable and does not redirect

#### Scenario: Landing after a successful payment
- **WHEN** the server records the payment as paid at the end of the purchase
- **THEN** the owner lands on the event's management page

#### Scenario: Owner opens the setup flow after payment
- **WHEN** the owner opens the setup flow of an event in management
- **THEN** the owner is taken to the event page

### Requirement: Return visits land on the screen for the event's state
The system SHALL send a customer who signs in, verifies their email or returns later to the screen that matches the event's current state.

#### Scenario: New customer after email verification
- **WHEN** a customer with no event verifies their email
- **THEN** the customer lands on the create-first-event screen

#### Scenario: Returning customer mid-setup
- **WHEN** a customer whose only event is in setup signs in
- **THEN** the customer lands on that event's setup flow at the current step

#### Scenario: Returning customer after payment
- **WHEN** a customer whose only event is in management signs in
- **THEN** the customer lands on that event's management page

### Requirement: Single step list
The system SHALL show the list of setup steps exactly once on any screen, and only within the setup flow.

#### Scenario: Setup screen
- **WHEN** the owner is on any setup step, including payment
- **THEN** the step list appears once, above the step content

#### Scenario: Management page
- **WHEN** the owner is on the management page
- **THEN** no setup step list is shown

#### Scenario: Guests and statistics pages during setup
- **WHEN** the owner opens the guests or statistics page of an event in setup
- **THEN** the owner is taken to the setup flow; guests are managed after payment

### Requirement: Flat step content
The system SHALL present each step's content as one surface, separated by headings and dividers, without a framed panel inside another framed panel.

#### Scenario: Terms approval step
- **WHEN** the owner is on the package terms approval step
- **THEN** the key terms, the full-terms link and the approval boxes appear as sections of one surface, not as nested framed panels

### Requirement: Payment states inside setup
The system SHALL show each payment state of the chosen service as a state of the payment step.

#### Scenario: Not paid or declined
- **WHEN** there is no payment, or the last attempt was declined
- **THEN** the payment step offers payment, and a declined attempt shows a retry message

#### Scenario: In progress or under review
- **WHEN** a payment is in progress or under review
- **THEN** the payment step shows a waiting state without a payment form

#### Scenario: Payment record unavailable
- **WHEN** the payment record cannot be read
- **THEN** the payment step shows that the state is unavailable, never an empty payment form

### Requirement: Purchase is the end of setup, with no separate activation
The system SHALL treat the server-recorded purchase of the package as the start of the service. It SHALL NOT require a further customer action, a guest list or any other condition, and SHALL NOT show the customer an "activation" or "start" concept.

#### Scenario: Purchase with no guests yet
- **WHEN** the purchase is recorded and the event has no guests
- **THEN** the service is running and the owner lands on the management page with no start action and no "not started" state

### Requirement: Guests can be added at any time after purchase
The system SHALL let the owner add guests at any time after the purchase. Each added guest SHALL be approached on the package's schedule, up to the package quota, without any customer action beyond adding the guest.

#### Scenario: Guest added after purchase
- **WHEN** the owner adds a guest after the purchase and the quota is not reached
- **THEN** the guest is on the outreach list and receives the next scheduled messages

#### Scenario: Guest added beyond the quota
- **WHEN** the owner adds a guest after the quota is reached
- **THEN** the guest is added to the event and the owner sees that the guest is beyond the package quota

### Requirement: Navigation inside setup stays inside setup
The system SHALL keep every back and edit link of the setup flow within the flow while the event is in setup.

#### Scenario: Back from the package step
- **WHEN** the owner chooses back on the package step
- **THEN** the owner reaches the event details step inside the setup flow

#### Scenario: Editing details of a confirmed event during setup
- **WHEN** the owner edits event details after confirming them but before payment
- **THEN** the details are edited inside the setup flow, under the same locks as today

### Requirement: Closing is available during setup
The system SHALL offer the owner of an event in setup a way to close the event from within the setup flow, with a confirmation, following the event-closure rules.

#### Scenario: Draft event
- **WHEN** the owner of an event whose details are not yet confirmed chooses to close it
- **THEN** the close control is available and the event closes

#### Scenario: Owner closes during setup
- **WHEN** the owner confirms closing an event whose service is not paid
- **THEN** the event closes and the owner sees the closed event

### Requirement: Non-owner viewers are not trapped in setup
The system SHALL show a viewer who is not the event's owner a read-only "בהקמה" state for an event in setup, and SHALL NOT redirect that viewer into setup actions they cannot perform.

#### Scenario: Org member with campaign access
- **WHEN** an org member who may view the service but is not the owner opens an event in setup
- **THEN** they see that the event is in setup and which step it is at, with no action controls

#### Scenario: Org member without campaign access
- **WHEN** an org member who may view the event but not its service opens it
- **THEN** they see the event without service details and are not redirected

### Requirement: No "קמפיין" in customer-visible text
The system SHALL NOT show the word "קמפיין" in any text a customer sees on customer routes: step and status labels, headings, page titles, buttons, notices and error messages from the server. Staff-only views and URL paths are excluded.

#### Scenario: Step and status labels
- **WHEN** the customer views the setup steps or the service status
- **THEN** the labels use "אישורי הגעה" or "השירות" wording

#### Scenario: Server error reaches the customer
- **WHEN** a setup action fails with a message shown to the customer
- **THEN** the message does not contain "קמפיין"

#### Scenario: Browser tab title
- **WHEN** a customer opens the payment page
- **THEN** the page title does not contain "קמפיין"
