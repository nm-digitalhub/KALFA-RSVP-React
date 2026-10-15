## ADDED Requirements

### Requirement: A scheduled campaign call refused only for now is retried, not dropped

The system SHALL, when a non-manual outbound campaign call is refused because the dial window is closed, every call slot is busy, the campaign's hourly cap is full, or the account balance is under the reserve, send that same call again after a wait that fits the reason. It SHALL NOT complete the job as a final skip or block while a moment exists before the end of the event day.

#### Scenario: Dispatch inside the window with capacity
- **WHEN** a scheduled campaign call is dispatched while the dial window is open and no cap or balance gate refuses it
- **THEN** the call proceeds through the remaining gates as before

#### Scenario: Dispatch before the window opens
- **WHEN** a scheduled campaign call is dispatched at 07:00 on a day whose dial window opens at 08:00
- **THEN** the same call is sent again for the window opening
- **AND** no call attempt row exists for the refused dispatch

#### Scenario: Dispatch on Shabbat or a holiday
- **WHEN** a scheduled campaign call is dispatched during Shabbat or Yom Tov
- **THEN** it is sent again for the first open instant after the block, inside the dial window of that day

#### Scenario: Window narrowed after the round was planned
- **WHEN** the admin shortens a weekday's dial window after a call round was planned
- **AND** the round fires outside the shortened window
- **THEN** the round is deferred under the live window and is not lost

#### Scenario: All call slots busy
- **WHEN** the number of active calls across all dispatch surfaces has reached the concurrency cap
- **THEN** the call is sent again after a short wait
- **AND** no call attempt row and no provider call exist for the refused dispatch

#### Scenario: Campaign hourly cap full
- **WHEN** the campaign has already placed its maximum calls in the last hour
- **THEN** the call is sent again after a wait, and not dialled now

#### Scenario: Balance under the reserve
- **WHEN** the account balance is under the call reserve
- **THEN** the call is sent again after a wait, so a top-up lets it through
- **AND** the ops alert for the low balance is sent on the first delivery only

### Requirement: Retrying is bounded and never silent

The system SHALL stop retrying when the next moment is not before the end of the event day, when the event end is unknown, or after a fixed maximum number of waits. It SHALL then settle the job with the answer the dispatcher gave, log the refusal and the reason it settled, and send an ops alert naming the campaign and the step.

#### Scenario: No moment before the event ends
- **WHEN** the next moment falls on or after the end of the event day
- **THEN** the job settles as skipped (or blocked for the balance) with the original reason
- **AND** an ops alert is sent and the reason is logged

#### Scenario: Wait limit reached
- **WHEN** a call has been sent again the maximum number of times
- **THEN** it settles and an ops alert is sent

### Requirement: Retrying never causes a second dial

The system SHALL give each wait its own deterministic job id, so a redelivered job cannot enqueue the same wait twice, SHALL create the call attempt only after every refusing gate has passed, and SHALL evaluate every gate again with fresh data when the call comes back.

#### Scenario: Redelivery of the deferring job
- **WHEN** the job that sent a call again is delivered once more before it completes
- **THEN** the same job id is used and no second waiting job exists

#### Scenario: Gates run again when the call returns
- **WHEN** a waiting call comes back
- **THEN** consent, removal list, already-reached, campaign status, event-closed, window, caps and balance are evaluated again

### Requirement: Final refusals stay final

The system SHALL NOT retry a call refused for a missing consent, a number on the removal list, a guest who already answered, a closed event, a call owned by another dispatch, or a missing package seat, nor a provider outcome (a failed or an ambiguous start). Provider outcomes never dial again.

#### Scenario: Removal list
- **WHEN** a scheduled call is refused because the number is on the removal list
- **THEN** no waiting job is created

#### Scenario: Ambiguous provider start
- **WHEN** the provider's answer to a start request is ambiguous
- **THEN** the call is never dialled again

### Requirement: Manual dials are not rescheduled

The system SHALL keep the existing behaviour for a manual console dial and for the workflow callback action: when refused for any reason above, it is skipped or blocked and reported, and is not rescheduled automatically.

#### Scenario: Operator dials outside the window
- **WHEN** a staff member requests a manual dial while the dial window is closed
- **THEN** the dial is skipped with reason `outside_dial_window`
- **AND** no waiting job is created
