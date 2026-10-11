## ADDED Requirements

### Requirement: Registry check applies by call purpose

The system SHALL consult the national Do-Not-Call registry before an outbound call whose purpose is marketing, as defined by Consumer Protection Law section 16ב(א). It SHALL NOT consult the registry for calls whose purpose is not marketing. Each dial path SHALL declare its policy (`required`, `exempt_if_requested` or `not_applicable`) in one shared policy table.

#### Scenario: RSVP call is not gated by the registry
- **WHEN** an RSVP call to an event guest is dispatched
- **THEN** the registry is not consulted
- **AND** the local removal list is still checked

#### Scenario: Sales call requires a check
- **WHEN** a sales call is dispatched to a number with no stored callback-request evidence
- **THEN** the registry is consulted before the provider is called

#### Scenario: Requested callback is exempt only with evidence
- **WHEN** a sales call is dispatched for a callback request whose origin is `person_request`
- **THEN** the registry is not consulted
- **AND** the check record stores the callback request id as the exemption reference

#### Scenario: Returning a missed call is exempt
- **WHEN** a call is dispatched to return a call the person placed to KALFA (origin `missed_call`)
- **THEN** the registry is not consulted

#### Scenario: Row no person initiated
- **WHEN** a call is dispatched for a callback request whose origin is `staff`, `workflow` or `unknown`
- **THEN** the exemption does not apply and the policy of the dial path decides

#### Scenario: Manual dial declares its purpose
- **WHEN** a staff member dials a number manually from the console
- **THEN** they must choose "sales" or "service" before the dial
- **AND** a sales dial is checked against the registry

### Requirement: Local list is checked first and kept separate

The system SHALL check the local removal list before calling the registry. It SHALL NOT add registry results to the local list.

#### Scenario: Locally blocked number
- **WHEN** the number is on the local list
- **THEN** the result is `local_blocked`, the registry is not called, and no dial happens on any path

#### Scenario: Registry result is not copied
- **WHEN** the registry reports a number as listed
- **THEN** no row is added to the local list

### Requirement: Answers are validated and interpreted conservatively

The system SHALL validate the registry's answer against the documented shape at runtime. It SHALL treat a number as listed only when the number is absent from a fully validated answer.

#### Scenario: Number is returned as a string
- **WHEN** a validated answer contains the number with its leading 0 as a string
- **THEN** the result is `registry_clear`

#### Scenario: Number is absent
- **WHEN** a validated answer contains neither the number nor an error object for it
- **THEN** the result is `registry_listed`

#### Scenario: Error for the number
- **WHEN** the answer contains `{phone, errorCode}` for the number
- **THEN** the result is `registry_unchecked` and the check does not authorize a dial

#### Scenario: Malformed answer or failed call
- **WHEN** the answer fails validation, or the call fails (HTTP error, timeout, unreachable, credentials not configured)
- **THEN** the result is `registry_unavailable`, never `registry_listed`

#### Scenario: Foreign number
- **WHEN** the number is not an Israeli (+972) number
- **THEN** it is not converted, the registry is not called, and the result is `not_covered`

### Requirement: Temporary failure waits before dialling

When a marketing dial's check returns `registry_unavailable`, the system SHALL defer the dial, re-attempt the check a bounded number of times, and only then settle it as skipped with reason `registry_pending`. The wait SHALL happen before any call attempt is created or the provider is contacted.

#### Scenario: Registry recovers
- **WHEN** the check is unavailable and succeeds on a later attempt within the bound
- **THEN** the dial proceeds under the other gates, and exactly one provider call is made

#### Scenario: Registry stays down
- **WHEN** the check is still unavailable after the last permitted wait
- **THEN** the job settles as skipped with reason `registry_pending` and no provider call is made

### Requirement: Every check used for a dial decision is recorded

The system SHALL record, in a table that only the server can write and that cannot be updated or deleted, each check used in a dial decision. The record SHALL contain:
- the E.164 number
- the check time
- the result and its source
- the service's transaction id, when one was returned
- the error code, when one was returned
- the purpose and the dial path
- the exemption reference, when an exemption applied
- the job id or attempt id

It SHALL NOT contain tokens or authentication headers.

#### Scenario: Customer cannot write a check record
- **WHEN** an authenticated customer tries to insert into or update the check table
- **THEN** the database refuses

### Requirement: Operations scripts cannot dial arbitrary numbers

Operations scripts that start provider calls SHALL refuse any destination that is not on the configured test-number allowlist. When they dial a product record's own number, they SHALL apply the same gates as the product path.

#### Scenario: Arbitrary number in a script
- **WHEN** an operator runs a script with `--to` set to a number not on the allowlist
- **THEN** the script exits without contacting the provider
