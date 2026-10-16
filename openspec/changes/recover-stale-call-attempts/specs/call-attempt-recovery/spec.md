## ADDED Requirements

### Requirement: A stuck attempt never holds call capacity beyond a ceiling

The system SHALL exclude from the active-call count any attempt whose status is still `queued`, `dialing` or `in_progress` and whose age exceeds a ceiling longer than the longest call the platform can place. The ceiling SHALL apply to every table that feeds the count, so no single surface can exhaust the shared cap with orphaned rows.

#### Scenario: Orphaned rows do not block new calls
- **WHEN** the number of rows in an active status older than the ceiling alone would reach the cap
- **THEN** the active-call count does not include them
- **AND** a scheduled call is dispatched normally

#### Scenario: A real call is still counted
- **WHEN** an attempt in an active status is younger than the ceiling
- **THEN** it is counted

### Requirement: Rows with no confirmed provider session settle through their surface's own "unknown" helper

The system SHALL settle an attempt that has been in an active status longer than the stale threshold and has no provider session id through the closing helper of its own surface (`markStartUnknown` for RSVP calls, `markCallbackDispatchUnknown` for meeting confirmation, `markSalesDispatchUnknown` for sales), and SHALL NOT dial it again. The settle is deliberately conservative: it may mark an attempt that never reached the provider.

#### Scenario: Worker stopped between creating the row and the provider call
- **WHEN** an attempt has no provider session id and is older than the stale threshold
- **THEN** its status becomes the surface's "unknown" status with a recorded reason
- **AND** an ops alert names the table and the count

#### Scenario: The ceiling does not change a row
- **WHEN** a row older than the capacity ceiling later receives its terminal callback
- **THEN** it settles as usual, because the ceiling only changed the count

#### Scenario: A real outcome is never overwritten
- **WHEN** the attempt reached a terminal status between the read and the settle
- **THEN** the settle does not change it

### Requirement: Rows with a provider session are settled from the provider's record

The system SHALL, for a stale attempt that has a provider session id, read the provider's record of that session by session id and settle by it, never twice and never with a conversation result the provider cannot supply.

#### Scenario: Session ended, callback lost
- **WHEN** the provider shows the session ended and the row is still active
- **THEN** the row is settled once, with no billing or RSVP effect applied twice

#### Scenario: The lookup by session id is proven
- **WHEN** the provider is asked for a known session id
- **THEN** exactly one record is returned for it

#### Scenario: Session still running
- **WHEN** the provider shows the session running
- **THEN** the row is left unchanged and no alert about the row repeats

#### Scenario: Provider has no record of the session
- **WHEN** the provider has no record of the session two hours after the attempt was created
- **THEN** the row settles through its surface's "unknown" helper and is never dialled again

#### Scenario: Provider unreachable
- **WHEN** the provider lookup fails
- **THEN** nothing is settled and the next run tries again

### Requirement: Recovery is visible

The system SHALL keep the stuck-row alert and SHALL send an ops alert whenever recovery settles a row, naming the table, the count and the settle path, with no personal data.

#### Scenario: Recovery acts
- **WHEN** a reconcile run settles one or more rows
- **THEN** a single alert summarises them
