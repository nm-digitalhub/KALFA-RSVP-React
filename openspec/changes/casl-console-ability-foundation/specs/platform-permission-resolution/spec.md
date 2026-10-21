# Spec Delta

## Purpose

How the platform permission keys a staff caller holds are resolved, for the cookie session and for the
Bearer console API alike; how the action ability is built from them; and how a client that already
loaded its rules learns they changed. The database permission catalogue stays the only authority.

## ADDED Requirements

### Requirement: Held keys come from one database resolution
The set of platform permission keys a caller holds SHALL be resolved by one database call per request.
It SHALL hold only keys of the permission catalogue. A caller in the owner role SHALL hold every
catalogue key, and any other staff caller SHALL hold the keys granted to its role. The result SHALL equal
the per-key permission check and the `permissions` column of the caller's console profile, for every
catalogue key.

#### Scenario: Parity per role and key
- **WHEN** the resolution runs for a fixture user in each platform role, and for a non-staff user
- **THEN** for every catalogue key, the key is in the result exactly when the per-key check answers true

#### Scenario: Owner and unknown keys
- **WHEN** an owner's keys are resolved
- **THEN** the result is the whole catalogue and nothing outside it, even though the per-key check also
  answers true for an unknown key

#### Scenario: Console profile agreement
- **WHEN** an agent's keys are resolved
- **THEN** they equal the `permissions` its `console_me` row returns

#### Scenario: Anonymous caller
- **WHEN** an anonymous Data API caller asks for the resolution
- **THEN** it is refused with `42501`

### Requirement: The ability is the same for every auth source
The action ability SHALL be built from the held keys only, by the same rules, whether the request
carries the cookie session or a Bearer token. A key the caller does not hold SHALL add no rule.

#### Scenario: Cookie and Bearer agree
- **WHEN** the same user's ability is built once from the cookie session and once from its Bearer token
- **THEN** both abilities allow exactly the same actions

#### Scenario: Default deny
- **WHEN** a caller holds no key
- **THEN** the ability allows no action

### Requirement: Building the ability costs one key resolution per request
Rendering an admin page SHALL resolve the caller's keys once, whatever number of subjects and keys the
action map holds.

#### Scenario: Admin render
- **WHEN** the admin layout and its navigation are rendered for a staff caller
- **THEN** exactly one key resolution is made for that request

### Requirement: Stale client rules are refreshed when the server refuses
Rules shown in an already-loaded interface are a display aid only. When a server gate refuses an action
the interface offered, the interface SHALL reload its rules from the server. No server decision SHALL
depend on the client's rules.

#### Scenario: Key withdrawn while the page is open
- **WHEN** a key is withdrawn from a role while a member has the page open and uses a control that needs it
- **THEN** the server refuses with 403, and the interface reloads and stops offering that control

#### Scenario: Forged client rules
- **WHEN** a request is sent as if the client's rules allowed an action that the database does not grant
- **THEN** the server refuses it

### Requirement: Names that the evaluator treats as wildcards are not used
No subject SHALL be named `all`, and no action SHALL be named `manage`.

#### Scenario: Map check
- **WHEN** the action map is inspected
- **THEN** neither name appears
