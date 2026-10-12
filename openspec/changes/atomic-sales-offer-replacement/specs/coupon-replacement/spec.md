## ADDED Requirements

### Requirement: Atomic replacement
The system SHALL release, void, replace, freeze options, record history and re-bind an eligible existing sales benefit in one database transaction.

#### Scenario: Failure after void
- **WHEN** saving options or re-binding the new benefit fails after voiding the old benefit
- **THEN** the old benefit, pricing and prior history remain unchanged and no replacement is committed

### Requirement: Durable result after uncertain response
The server SHALL read persisted active benefit state after the replacement RPC and SHALL NOT advertise a cached old benefit after losing the RPC response.

#### Scenario: Lost response after commit
- **WHEN** the RPC commits but its response is lost
- **THEN** the server returns the persisted active benefit if it can verify it, otherwise no offer

### Requirement: Restricted invocation
Only service_role SHALL have EXECUTE permission on the replacement RPC.

#### Scenario: Browser role
- **WHEN** an authenticated or anonymous client attempts replacement
- **THEN** it cannot execute the RPC
