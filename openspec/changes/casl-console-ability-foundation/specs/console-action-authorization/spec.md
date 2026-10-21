# Spec Delta

## Purpose

Which live-call and campaign actions a console agent may perform, how the console API enforces them, and
how the softphone decides which controls to offer. These are the console's action permissions. Its data
access, defined by `console-access-control`, and its eligibility (being an active agent) are separate and
unchanged.

## ADDED Requirements

### Requirement: Console actions are bound to existing permission keys
Every console action SHALL be declared once, bound to one existing catalogue key:
- consult, conference and transfer on a console call → `manage_voice`;
- dial → `manage_voice`;
- monitor, command and end on an AI call → `manage_voice`;
- starting an outreach call to a guest → `manage_voice`;
- changing a campaign's run state → `campaigns.runstate`.

No new key and no role grant SHALL change.

#### Scenario: One declaration per action
- **WHEN** the action map is inspected
- **THEN** each console action above appears once, with its key, and every key is in the catalogue

#### Scenario: Who holds an action
- **WHEN** a role's grants are compared before and after this change
- **THEN** every member may perform exactly the console actions whose key the role held before

### Requirement: The console API refuses an action without its key, before doing anything
Each console route SHALL first establish that the caller is an active agent, then that it holds the key
of the action. Both checks SHALL run before the request body is read and before any data is touched.
Without a valid token the answer SHALL be 401. Without eligibility or the key it SHALL be 403. Operational
refusals, such as wrong call state or call kind, a terminal call, a target that is not ready,
concurrency, DNC or quiet hours, SHALL keep their current answers.

#### Scenario: Agent without the key
- **WHEN** an active agent without `manage_voice` posts to consult, conference, transfer, monitor, command,
  end, dial-intent or outreach-call
- **THEN** each answers 403 and the body is never read

#### Scenario: Agent with the key but wrong call state
- **WHEN** an agent holding the key consults on a call that is not connected
- **THEN** the route answers as it does today

### Requirement: The softphone offers only actions the server would allow
A live-call control SHALL be shown only when the caller holds the action's key, the call meets the
action's display conditions, and the feature flag is on. The display conditions SHALL come from the same
constants the server checks. Whenever a control is shown, the server's operational checks that the
client can see SHALL pass. The server may still refuse for facts only it can see.

#### Scenario: Agent without manage_voice
- **WHEN** an active agent without `manage_voice` has a connected customer call
- **THEN** no consult, conference, transfer, monitor, takeover or close control is shown

#### Scenario: Call state decides
- **WHEN** an agent holding `manage_voice` has a call that is ringing, ended, or of a kind that cannot be
  consulted
- **THEN** the consult and conference controls are not shown

#### Scenario: Implication table
- **WHEN** every combination of call kind, call status and terminal state is evaluated
- **THEN** every combination for which a control is shown passes the server's corresponding operational
  checks

### Requirement: Decisions that stay outside the action ability
The following SHALL NOT be decided by the action ability:
- being an active agent;
- row and column data access, including event scope and the phone mask;
- the provisioned flag;
- feature flags;
- the live-call concurrency limit;
- DNC, opt-out and quiet hours;
- target readiness;
- claim ownership of an AI call.

Each SHALL keep its current single source: the database, the configuration or the server.

#### Scenario: No duplicate rule
- **WHEN** the action map and its condition table are inspected
- **THEN** none of the decisions above appears in them, and no copy of a server-only constant exists in a
  client file
