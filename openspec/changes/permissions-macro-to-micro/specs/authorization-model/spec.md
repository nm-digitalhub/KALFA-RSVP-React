# Spec Delta

## Purpose

How KALFA decides who may do what, from the identity of the caller down to the gate that enforces it, the same way on
every transport. It also defines the place of console membership: an operational attribute, never a source of
permission.

## ADDED Requirements

### Requirement: Every caller belongs to exactly one identity axis
Every request SHALL be authorized under one of these axes:
- a sessionless credential holder;
- an event owner or organization member;
- a platform staff member;
- a delegated agent acting for a staff member;
- the system itself, acting on a recorded fact such as a payment.

The platform owner SHALL be a staff member whose role holds every key, not a separate axis with its own gates.

#### Scenario: Owner has no gate of its own
- **WHEN** the code and the database's policies and functions are scanned
- **THEN** no gate checks "is the platform owner" instead of a permission key

#### Scenario: Owner still passes every staff gate
- **WHEN** a member of the owner role calls any staff entry point
- **THEN** it is allowed, because the role holds every catalogue key

### Requirement: A staff gate decides through a CASL action bound to one catalogue key
Every staff authorization decision SHALL be expressed as an action on a subject. The action SHALL be declared once in
the shared action map and bound to exactly one key of the platform catalogue. No entry point SHALL name a key as a
literal.

#### Scenario: Literal key in a gate
- **WHEN** a server file calls a gate with a catalogue key written as a string
- **THEN** the static check fails and names the file

#### Scenario: Moving a gate onto the map changes no access
- **WHEN** a literal gate is replaced by its action
- **THEN** the action is bound to the key the literal named, and every role that passed before passes after

### Requirement: The same action is enforced the same way on every transport
A staff action SHALL be decided by the same key whether the caller uses a cookie session, a Bearer token from the
console clients, an OAuth token on the MCP endpoint, or a delegated agent. Transport SHALL decide only how the caller
is identified, never what the caller may do.

#### Scenario: Bearer and cookie agree
- **WHEN** the same staff member performs the same action once through a web page and once through the console API
- **THEN** both are allowed, or both are refused, by the same key

#### Scenario: MCP endpoint and owner agent agree
- **WHEN** the same staff member uses the MCP endpoint and the WhatsApp owner agent
- **THEN** both offer exactly the tools whose actions the member's keys allow

### Requirement: Console membership is an operational precondition, never an authorization answer
Being an enrolled, active console agent SHALL be required only for what a seat at the console needs:
- signing in the SDK;
- reporting one's own status and shift;
- device telemetry;
- placing a dial from one's own softphone;
- joining a call to monitor it;
- one's own agent rows and one's own live call;
- the colleague directory and presence, the queues and the agents' chat.

Every other console route and console data read SHALL be decided by a key, and SHALL NOT require membership.

#### Scenario: Staff with the key, not enrolled
- **WHEN** a staff member who holds `campaigns.runstate` but is not a console agent pauses a campaign through the
  console API
- **THEN** it is allowed

#### Scenario: Enrolled agent without the key
- **WHEN** an active console agent without `view_customer_data` requests the call history or the callback queue
- **THEN** it is refused, and no caller phone number is returned

#### Scenario: Enrolled agent without the key sees its own call
- **WHEN** an active console agent without the console data keys has a ringing or connected call
- **THEN** it sees that call, the guest on it and its live updates, and no other agent's call

#### Scenario: Enrolled agent without the key keeps the shared console
- **WHEN** an active console agent without the console data keys opens the console
- **THEN** it sees its colleagues, their presence and the agents' chat, and no customer's campaigns, guests or RSVP
  answers beyond its own call's guest

#### Scenario: Blocked agent keeps no live identity
- **WHEN** an agent whose Voximplant user is blocked signs in to the SDK or joins a call to monitor it
- **THEN** it is refused, even if the agent holds every key

#### Scenario: Blocking removes the identity, not the keys
- **WHEN** an agent whose Voximplant user is blocked, and who holds the live-call key, ends an AI call through the
  console API
- **THEN** it is allowed, because blocking removes only the live identity and authority is removed by revoking the
  role

### Requirement: The permission map is checked, not described
The macro → micro map (axis → role → key → action → gate) SHALL be produced by tooling from the code and the live
catalogue. It SHALL cover every transport and every gate type, including column grants and Realtime channel
policies. The tooling SHALL fail when:
- a gate is unrecognized;
- an SQL key literal is not in the catalogue;
- an entry point checks one key while the data it always reaches requires another;
- a menu entry is offered to a caller the page will refuse.

#### Scenario: CASL gate recognized
- **WHEN** an entry point is gated by a CASL action before its first data operation
- **THEN** the analyzer reports it as gated by that action's key

#### Scenario: Entry key differs from data key
- **WHEN** a page checks `integrations.manage` and always reaches code that requires `integrations.read`
- **THEN** the analyzer reports a mismatch

#### Scenario: Console and MCP routes are mapped
- **WHEN** the map is generated
- **THEN** every console Bearer route and the MCP endpoint appear with their transport and their gates

### Requirement: Keys that grant authority over permissions stay with the owner role
`roles.manage` and `manage_staff` let a holder grant further keys. They SHALL gate role and staff management, and
SHALL be held only by the owner role unless the owner decides otherwise. No one SHALL change their own role or their
own role's grants. Only an owner-role member SHALL assign the owner role or a role holding either key, or change an
owner-role member's role. Role and staff writes SHALL go through one checked path that records the actor.

#### Scenario: Roles page gated by its key
- **WHEN** a staff member without `roles.manage` opens role management
- **THEN** it is refused

#### Scenario: Self-escalation refused
- **WHEN** a holder of `manage_staff` who is not an owner-role member assigns itself the owner role, or a role
  holding `roles.manage`
- **THEN** it is refused, and nothing changes

#### Scenario: Owner demotion refused
- **WHEN** a holder of `manage_staff` who is not an owner-role member changes or revokes the role of an owner-role
  member
- **THEN** it is refused, and nothing changes

#### Scenario: Direct write refused
- **WHEN** a signed-in staff member writes to the staff table through the database API
- **THEN** it is refused, because the client role holds no write privilege on that table

#### Scenario: Actor recorded
- **WHEN** the owner grants a key to a role
- **THEN** the role audit names the owner as the actor

#### Scenario: Role change and revoke name the actor
- **WHEN** a staff member's role is changed, or the staff member is revoked, through role management
- **THEN** exactly one role audit row records the change and names the staff member who made it
