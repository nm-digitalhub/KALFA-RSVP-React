# Spec Delta

## Purpose
How every outbound message or call to a guest is initiated, scheduled, previewed, confirmed, changed for one event, audited and explained, so that customers, staff and the event assistant all see and act on one truthful timing model.

## ADDED Requirements

### Requirement: Every outbound send has an initiator
Every outbound message or call to a guest SHALL be recorded as either KALFA-initiated or customer-initiated, with the reason for the send.

- KALFA-initiated: steps of the package schedule (or of its per-event change), the default thank-you time, and automatic calls.
- Customer-initiated: a manual send, or a time the customer explicitly chose.

#### Scenario: Package step is KALFA-initiated
- **WHEN** the engine sends the 3-days-before WhatsApp step of a package schedule
- **THEN** the outbound record says KALFA-initiated and names the schedule step

#### Scenario: Manual gift reminder is customer-initiated
- **WHEN** an authorized customer confirms a gift-reminder send
- **THEN** each outbound record says customer-initiated, names the confirmed proposal, and is non-billable as today

### Requirement: KALFA-initiated sends obey the KALFA window
A KALFA-initiated send SHALL go out only inside the KALFA send window. The window is today's policy: weekday hours, Friday until noon, no Shabbat, no holiday, a gap after Shabbat ends, and the hard ceilings in code. A KALFA-initiated call SHALL be planned with the same call-hours policy it is dialled with, so the planned time and the dial time agree.

#### Scenario: Default thank-you after a Friday event
- **WHEN** an event takes place on a Friday and the customer has not chosen a thank-you time
- **THEN** the thank-you is scheduled for the first allowed slot at or after Saturday 10:00. Saturday has no KALFA window, so that is Sunday at 10:00, and never Shabbat

#### Scenario: Call step planned in call hours
- **WHEN** a call step's preferred time falls outside the call-hours policy but inside the WhatsApp window
- **THEN** the planned time shown for it is the first call-hours slot, the same slot the dialler would use

### Requirement: Customer-initiated sends are never blocked by the calendar
A customer-initiated send or a customer-chosen time SHALL be allowed at any hour and on any day. Before confirmation, the customer SHALL see a warning when the effective time falls at night, on Shabbat or on a holiday. The confirmation SHALL record that the warning was shown. A time in the past SHALL be refused for a scheduled send; a "send now" is not a scheduled time.

#### Scenario: Customer chooses Shabbat
- **WHEN** a customer sets the thank-you to Saturday 11:00
- **THEN** the preview warns "המועד שבחרת נופל בשבת", the customer can confirm, the send happens at that time, and the audit row records the acknowledged warning

#### Scenario: Past time
- **WHEN** a customer submits a thank-you time that has already passed
- **THEN** the proposal is refused with a message asking for a future time, and nothing changes

### Requirement: Per-event schedule changes stay inside the package
For one event, an authorized user MAY move a step of the package schedule to another day and time, or skip it. A change SHALL NOT:
- add a step;
- change a step's channel;
- move a KALFA step outside the KALFA window;
- reorder steps so that a later step precedes an earlier one;
- touch a step that was already sent.

The package snapshot taken at purchase SHALL stay unchanged. Every accepted change SHALL produce a new numbered version of the event's effective schedule.

#### Scenario: Skip a step
- **WHEN** the owner skips the 1-day-before call step
- **THEN** the effective schedule version increases by one, no guest is called for that step, and the other steps keep their times

#### Scenario: Move into Shabbat refused
- **WHEN** a user moves a KALFA step to Saturday 12:00
- **THEN** the proposal is refused and names the first allowed slot instead

#### Scenario: Add a step refused
- **WHEN** a request asks for an extra reminder that the package does not contain
- **THEN** it is refused and says the package does not include it

### Requirement: Changes and sends go through confirmed proposals
Every per-event schedule change, thank-you time change and manual send SHALL first be created as a proposal. A proposal SHALL state:
- the exact effective times;
- the number of guests affected;
- every warning.

A proposal SHALL be applied only by an explicit confirmation from a user who is still authorized at confirmation time. It SHALL be applied at most once. It SHALL expire if not confirmed within 30 minutes, or if the schedule version it was computed against has changed.

#### Scenario: Double confirmation
- **WHEN** the same proposal is confirmed twice, for example from two tabs
- **THEN** it is applied once and the second confirmation reports that it was already applied

#### Scenario: Stale proposal
- **WHEN** another user changes the schedule after a proposal was created
- **THEN** confirming the older proposal is refused and asks for a new preview

#### Scenario: Permission revoked before confirmation
- **WHEN** a user's timing permission is removed after the proposal was created
- **THEN** the confirmation is refused

### Requirement: Manual sends are idempotent per guest
A manual send of the same message to the same guest for the same event SHALL reach that guest at most once per send kind, whatever the number of clicks, tabs or retries. This covers gift, event-day and thank-you.

#### Scenario: Gift reminder pressed twice
- **WHEN** the gift reminder is confirmed, and then confirmed again in a second proposal
- **THEN** guests who already received it are not sent it again, and the second preview shows that they are excluded

### Requirement: The thank-you state is explicit and truthful
The thank-you SHALL have one visible state: not scheduled, scheduled for a time, sending, sent, or will not send. A will-not-send state carries a reason, such as event closed or service closed. Turning the thank-you off or moving it SHALL be refused once sending started. A manual thank-you SHALL be reflected in the state.

#### Scenario: Disable during sending
- **WHEN** the owner tries to turn the thank-you off while it is sending
- **THEN** the change is refused with "ההודעה כבר בשליחה"

#### Scenario: Service closed before the thank-you
- **WHEN** the service is closed before the scheduled thank-you time
- **THEN** the customer sees that the thank-you will not be sent and why

### Requirement: Next-contact time is truthful
For every guest in the outreach, the system SHALL report the planned time of the next message or call. It SHALL use the stored planned time of the current step and the same computation the engine uses for later steps. It SHALL report "no further contact" with the reason when outreach for that guest has ended.

#### Scenario: Guest with an armed step
- **WHEN** a guest's 3-days-before step is planned for Monday 11:20
- **THEN** every surface (customer page, assistant, staff board) shows Monday 11:20 for that guest

#### Scenario: Guest already answered
- **WHEN** a guest has confirmed attendance and outreach stopped
- **THEN** the next contact is reported as none, with the reason "ענה"

### Requirement: Why a guest was not contacted is recorded
When an automatic call or message to a guest is skipped, the reason SHALL be recorded in a form the customer surfaces and the assistant can read. Reasons include no consent, do-not-call list, outside hours, hourly cap, superseded step, missed window, invalid phone and opted out.

#### Scenario: Do-not-call registry
- **WHEN** an automatic call to a guest is skipped because the number is on the do-not-call registry
- **THEN** the guest's history shows the skip and its reason

### Requirement: Timing permission
A new event permission, "timing and sends to guests", SHALL be required to:
- create or confirm any proposal of this capability;
- see its controls.

The event owner SHALL always hold it. No other organization role SHALL hold it by default. The organization owner MAY grant it to a role from the team roles screen. A user without it SHALL NOT see send or timing controls. Read-only timing information follows the existing view permissions.

#### Scenario: Member without the permission
- **WHEN** an organization member with campaign view but without the timing permission opens the event's service page
- **THEN** no send or timing control is rendered, and a direct call to the action is refused

#### Scenario: Owner grants it
- **WHEN** the owner grants the permission to the member role
- **THEN** members see the controls and their confirmed changes are audited under their own user

### Requirement: Customer actions are audited
Every created, confirmed, refused or expired proposal, and every customer-initiated send, SHALL be written to the activity log. The row SHALL hold:
- the event;
- the actor;
- the surface (screen or assistant);
- the proposal id;
- the confirmation time;
- the acknowledged warnings.

The row SHALL hold no message text and no guest contact details.

#### Scenario: Change through the assistant
- **WHEN** a customer confirms an assistant proposal to skip a step
- **THEN** the activity log shows the customer as actor, "assistant" as surface and the proposal id

### Requirement: No unrestricted send endpoint
There SHALL be no endpoint that sends an arbitrary message template to an event's guests outside the proposal flow.

#### Scenario: Old endpoint
- **WHEN** a request is made to the former any-template send endpoint
- **THEN** it does not exist (404)
