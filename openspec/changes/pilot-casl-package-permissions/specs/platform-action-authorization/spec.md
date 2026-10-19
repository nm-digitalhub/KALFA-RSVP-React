# Spec Delta

## Purpose

Each admin action is authorized by one declared rule that binds the action to one database
permission key. The server enforces that rule, and every control that leads to the action follows the
same rule. A staff member is therefore shown exactly the package controls they may use, and is refused
on the server whatever the interface shows.

## ADDED Requirements

### Requirement: Every package action is bound to one database permission key
Each admin action on a package (viewing the admin catalogue or one package, creating, updating, deleting)
SHALL be declared once and bound to exactly one key that exists in the platform permission catalogue.
The binding SHALL be the only place in the package flow that names a permission key.

#### Scenario: One declaration per action
- **WHEN** the package flow's source is inspected
- **THEN** each of view, create, update and delete is bound to one catalogue key in one declaration, and no other file of the flow names a permission key

#### Scenario: Viewing and editing are separate actions
- **WHEN** the binding for viewing packages is changed to a different key
- **THEN** who may view changes, and who may create, update or delete does not

### Requirement: The database decides who holds each package action
Whether a staff member may perform a package action SHALL be decided only by whether they hold the bound
key according to the platform permission tables, as `has_platform_permission` reports it. The
application SHALL NOT keep a list of roles of its own.

#### Scenario: The owner grants the key to a role
- **WHEN** the owner adds the bound key to a role in `/admin/roles`
- **THEN** a member of that role can perform the action on their next request, with no code change

#### Scenario: The key is withdrawn
- **WHEN** the key is removed from a member's role
- **THEN** the member's next request for the action is refused

### Requirement: The server refuses a package action the caller may not perform
Every server entry point of the package flow SHALL check the caller's right to the action before it
reads input or touches data, and SHALL refuse with the existing access-denied redirect when the right is
missing. This covers each Server Action, each package page and each package data function. The check
SHALL NOT depend on what the interface displayed.

#### Scenario: A direct POST to a Server Action without the key
- **WHEN** a signed-in staff member without the bound key invokes the create, update, delete or copy-rewrite action directly
- **THEN** the request is redirected to `/access-denied`, no input validation result is returned, and no package row is read or changed

#### Scenario: Opening a package page without the key
- **WHEN** a staff member without the viewing key opens `/admin/packages` or `/admin/packages/<id>`, or without the create key opens `/admin/packages/new`
- **THEN** they are redirected to `/access-denied` before any package data is read

#### Scenario: Viewing a package without the right to edit it
- **WHEN** a staff member holds the viewing key but not the update key and opens `/admin/packages/<id>`
- **THEN** the package is shown without a save control, and a save posted directly is refused

#### Scenario: A data function called without the key
- **WHEN** any package data function runs for a caller without its bound key
- **THEN** it refuses before creating a database client

### Requirement: Package controls are shown only to those who may use them
The sidebar link, the dashboard card, the "new package" link and the delete control SHALL each be shown
only to a viewer who holds the action it leads to. Hiding a control SHALL NOT be the authorization; the
server check remains binding.

#### Scenario: A viewer with the key
- **WHEN** a staff member who holds the viewing and editing keys opens the admin area
- **THEN** the sidebar shows "חבילות", the dashboard shows the packages card, and the package pages show the new and delete controls

#### Scenario: A viewer without the viewing key
- **WHEN** a staff member who does not hold the viewing key opens the admin area
- **THEN** neither the sidebar link nor the dashboard packages card is shown

#### Scenario: Billing visibility without package management
- **WHEN** a staff member holds `view_billing` but not the key bound to viewing packages
- **THEN** the dashboard packages card is not shown, because its target would refuse them

### Requirement: Moving the package flow to the action map changes no other access
For every combination of permission keys a caller may hold, each package page, action and data function
SHALL allow exactly what it allowed before the change. The one exception is the dashboard packages card
listed in the previous requirement.

#### Scenario: Parity across key combinations
- **WHEN** the decision for each package page, action and data function is computed for every subset of the keys the flow uses
- **THEN** it equals the decision the previous `manage_billing` checks produced

#### Scenario: Flows outside the pilot
- **WHEN** any admin page outside the package flow is opened
- **THEN** its access is decided exactly as before the change
