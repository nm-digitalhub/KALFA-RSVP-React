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

### Requirement: Rows with no confirmed provider session settle as start_unknown

The system SHALL settle an attempt that has been in an active status longer than the stale threshold and has no provider session id as `start_unknown`, through the existing `markStartUnknown`, and SHALL NOT dial it again.

#### Scenario: Worker stopped between creating the row and the provider call
- **WHEN** an attempt has no provider session id and is older than the stale threshold
- **THEN** its status becomes `start_unknown` with a recorded reason
- **AND** an ops alert names the table and the count

#### Scenario: A real outcome is never overwritten
- **WHEN** the attempt reached a terminal status between the read and the settle
- **THEN** the settle does not change it

### Requirement: Rows with a provider session are settled from the provider's record

The system SHALL, for a stale attempt that has a provider session id, read the provider's record of that session and settle by it. When the session has ended, the outcome SHALL be applied through the same processing the post-call webhook uses. When the provider reports the session still running, the row SHALL be left unchanged. When the provider has no record of the session after a proof window, the row SHALL settle as `start_unknown`.

#### Scenario: Session ended, callback lost
- **WHEN** the provider shows the session ended and the row is still active
- **THEN** the outcome is applied once, by the webhook's own processing, so billing and RSVP effects are not duplicated

#### Scenario: Session still running
- **WHEN** the provider shows the session running
- **THEN** the row is left unchanged and no alert about the row repeats

#### Scenario: Provider unreachable
- **WHEN** the provider lookup fails
- **THEN** nothing is settled and the next run tries again

### Requirement: Recovery is visible

The system SHALL keep the stuck-row alert and SHALL send an ops alert whenever recovery settles a row, naming the table, the count and the settle path, with no personal data.

#### Scenario: Recovery acts
- **WHEN** a reconcile run settles one or more rows
- **THEN** a single alert summarises them
