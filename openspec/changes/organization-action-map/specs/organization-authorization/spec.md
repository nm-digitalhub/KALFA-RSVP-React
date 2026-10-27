# Spec Delta

## Purpose

How KALFA decides what a member of an organization may do. Each decision goes through one declared organization
action map, role management is held only by the owner role, and a decision is made in the organization whose role
grants the permission.

## ADDED Requirements

### Requirement: An organization decision goes through the organization action map
Every decision about what an organization member may do SHALL be expressed as an action on a subject, declared once in
an organization action map. Each action SHALL be bound to exactly one key of the organization permission catalogue,
and every catalogue key SHALL be bound to an action. No gate SHALL pass a resource/action pair written as strings.

#### Scenario: String pair in an org gate
- **WHEN** a server file checks an organization permission with resource and action written as strings
- **THEN** the static check fails and names the file

#### Scenario: Catalogue key without an action
- **WHEN** a key is added to the organization permission catalogue and no action is bound to it
- **THEN** the check fails and names the key

#### Scenario: Moving an org gate onto the map changes no access
- **WHEN** an event-scoped gate is replaced by its organization action
- **THEN** every member who passed before passes after, and every member refused before is refused after

#### Scenario: The RSVP service is an event action
- **WHEN** a member opens the RSVP service page of an event
- **THEN** access is decided by the event's view-RSVP action, bound to the catalogue key that grants viewing campaigns

### Requirement: Organization role management is a permission, not an owner check
Viewing and changing an organization's role permissions SHALL be gated by a dedicated organization key. That key SHALL
be held only by the organization's owner role, enforced by the catalogue's system-protected invariant. No gate SHALL
check "is the organization owner" instead.

#### Scenario: Organization admin opens the roles matrix
- **WHEN** a member with the admin role, who holds the organization manage permission, opens the organization's role
  permissions
- **THEN** it is refused and the member is returned to the team page, because only the owner role can hold the
  role-management key

#### Scenario: Organization owner opens the roles matrix
- **WHEN** the organization's owner opens the role permissions
- **THEN** they are shown and can be changed

#### Scenario: Existing organization owners keep role management after the migration
- **WHEN** the owner of an organization created before the role-management key existed opens the role permissions
  after the change
- **THEN** they are shown and can be changed

#### Scenario: The role-management key cannot be delegated
- **WHEN** an organization owner tries to grant the role-management key to the admin role
- **THEN** it is refused, and no role except the owner role holds the key

### Requirement: A member's permissions apply only in the organization that granted them
A user who belongs to more than one organization SHALL hold, in each organization, exactly the permissions of their
role there. An organization-scoped decision SHALL be made in the active organization, which the server SHALL honor
only after it verifies the membership. An event-scoped decision SHALL be made in the event's own organization,
whichever organization is active.

#### Scenario: Viewer in one organization, admin in another
- **WHEN** a user who is a viewer in organization A and an admin in organization B tries to edit a guest of an event in
  A
- **THEN** it is refused, and the same action on an event in B is allowed, whichever organization is active

#### Scenario: Admin in the active organization acts on another organization's event
- **WHEN** a user who is an admin in organization A, with A active, and a viewer in organization B tries to edit a
  guest of an event in B
- **THEN** it is refused

#### Scenario: Switching the active organization changes an organization-scoped decision
- **WHEN** a user who is an admin in organization B and a viewer in organization A switches the active organization
  from B to A
- **THEN** the team management page, which opened for them in B, is refused in A

#### Scenario: Organization the user does not belong to
- **WHEN** a user submits an organization they are not a member of as the active organization
- **THEN** it is ignored, and the active organization does not change

### Requirement: A role reset restores exactly what a new organization receives
Resetting an organization role to its default SHALL give it exactly the permissions that the same role receives in a
newly created organization. No default SHALL give a non-owner role a system-protected permission or the permission to
delete guests. The owner SHALL remain able to grant guest deletion to another role.

#### Scenario: Reset after customizing
- **WHEN** an owner changes the member role's permissions and then resets that role
- **THEN** the member role holds exactly what the member role of a newly created organization holds

#### Scenario: Defaults of a new organization
- **WHEN** a new organization is created
- **THEN** no non-owner role holds a system-protected permission or the permission to delete guests

#### Scenario: Owner opts a role into guest deletion
- **WHEN** an organization owner grants the permission to delete guests to the admin role
- **THEN** the grant is saved, and a member with the admin role can delete a guest of the organization's events
