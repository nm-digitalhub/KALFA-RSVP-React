# Spec Delta

## Purpose

The database itself enforces the platform permission matrix on staff-managed tables, so a staff
member cannot read or change data their role does not allow by calling the Data API directly with
their own session instead of going through the application.

## ADDED Requirements

### Requirement: New objects in `public` are closed to client roles by default
An object created in the `public` schema by the migration role SHALL NOT be reachable by `anon` or
`authenticated` until a migration grants access explicitly. `service_role` SHALL keep its default
privileges. Existing tables SHALL give `anon` no privilege except `SELECT` on `packages` and
`faq_items`.

#### Scenario: A new table
- **WHEN** a migration creates a table in `public` without any grant
- **THEN** `anon` and `authenticated` hold no privilege on it and `service_role` holds the usual ones

#### Scenario: A new function
- **WHEN** a migration creates a function in `public` without any grant
- **THEN** `anon`, `authenticated` and `PUBLIC` cannot execute it

#### Scenario: Existing anonymous access is unchanged
- **WHEN** an anonymous visitor loads a page that reads active packages or published FAQ items
- **THEN** the same rows are returned as before, and no other table answers `anon`

### Requirement: Service-only staff tables are closed to every user session
A staff-managed table that the application reaches only with the service role SHALL be unreachable
from any user session (`anon` or `authenticated`), for every platform role including the owner. The
set is: `otp_challenges`, `agreement_documents`, `webhook_inbox`, `workflows`, `workflow_runs`,
`workflow_run_events`, `workflow_run_steps`, `webhook_deliveries`, `outreach_template_failures`,
`vox_log_exports`.

#### Scenario: Staff member reads a closed table directly
- **WHEN** an authenticated staff member of any role queries a closed table through the Data API
- **THEN** the request is refused with a permission error (`42501`) and no row is returned or changed

#### Scenario: Application server paths keep working
- **WHEN** the application reads or writes a closed table with the service role after its own
  permission check
- **THEN** the operation succeeds exactly as before

#### Scenario: Anonymous caller
- **WHEN** an unauthenticated caller queries a closed table
- **THEN** the request is refused with a permission error (`42501`)

### Requirement: User-session staff tables require the permission their module is pinned to
A staff-managed table that staff reach with their own session SHALL be readable and writable only by
a user who holds the platform permission the table's application data-layer module already requires
(the owner holds every permission). One policy SHALL exist per operation the application uses,
scoped to `authenticated`.

#### Scenario: Mapping for billing and voice tables
- **WHEN** the policies are listed
- **THEN** `packages` requires `manage_billing`, and `call_dnc_list`, `call_compliance_settings`,
  `voice_purposes` and `voice_purpose_attempts` require `manage_voice`

#### Scenario: Mapping for settings tables
- **WHEN** the policies are listed
- **THEN** `message_templates`, `channels`, `faq_items`, `callback_schedule_policies`,
  `fleet_requests`, `fleet_goals`, `fleet_request_slack_threads` and `ops_alerts` require
  `manage_settings`, and `provider_numbers` and `provider_number_roles` require `manage_settings` OR
  `manage_voice`

#### Scenario: Holder of the permission
- **WHEN** a staff member holding the table's permission reads or changes it through the Data API or
  through the application
- **THEN** the operation succeeds and returns or changes the expected row

#### Scenario: Staff member without the permission
- **WHEN** a staff member who lacks the table's permission (for example `billing_clerk` on
  `message_templates`, or `auditor` on `packages`) queries or modifies it directly
- **THEN** reads return zero rows, and writes affect zero rows or are refused, and the targeted row
  is unchanged

#### Scenario: Either of two permissions
- **WHEN** a staff member holds only `manage_voice`, or only `manage_settings`, and works on
  `provider_numbers`
- **THEN** the operation succeeds in both cases and fails for a member holding neither

#### Scenario: Authenticated user who is not staff
- **WHEN** a customer session queries any staff-managed table
- **THEN** no row is returned and nothing can be written

#### Scenario: Operation the application never performs
- **WHEN** a user session attempts an operation on a table that no application path performs with a
  user session (for example `delete` on `call_compliance_settings`)
- **THEN** it is refused with a permission error, even for the owner

### Requirement: Existing public read access is preserved
The read policies that serve customers and public pages SHALL remain exactly as they are: active
`packages` readable by `anon` and `authenticated`, published `faq_items` readable by `anon` and
`authenticated`, and the `channels` catalogue readable by `authenticated`.

#### Scenario: Public page reads
- **WHEN** an anonymous visitor loads a page that lists active packages or published FAQ items
- **THEN** the same rows are returned as before the change

#### Scenario: Customer cannot see inactive packages
- **WHEN** a customer session queries `packages`
- **THEN** only rows with `active = true` are returned

### Requirement: Client roles hold only the privileges a path needs
For every table in this capability, `anon` and `authenticated` SHALL hold no `TRUNCATE`, `TRIGGER`,
`REFERENCES` or `MAINTAIN` privilege and no `SELECT`, `INSERT`, `UPDATE` or `DELETE` privilege that no
application path uses with that role. `anon` SHALL hold `SELECT` only on `packages` and `faq_items`.
`channels_admin_all` SHALL NOT remain a policy for `public`.

#### Scenario: Privilege inventory
- **WHEN** the table privileges of `anon` and `authenticated` are listed for the tables of this
  capability
- **THEN** each equals the set recorded in the access map

### Requirement: Entry-point functions enforce the same permission
A `SECURITY DEFINER` function that lets a user session read or change a table of this capability
SHALL enforce the platform permission that table requires, SHALL NOT rely on the retired
`has_role('admin')` axis, and SHALL pin `search_path` to empty. `EXECUTE` SHALL stay revoked from
`anon` and `public` on every such function, and from `authenticated` on those only the service role
calls.

#### Scenario: Staff member without the permission calls a fleet function
- **WHEN** a staff member lacking `manage_settings` calls `fleet_goal_create` through the Data API
- **THEN** the call is refused and no row is created

#### Scenario: Retired axis
- **WHEN** the current database schema is inspected (function bodies, policies and views in the catalog, not the historical migration files)
- **THEN** no active object references `has_role` or `user_roles`

### Requirement: The enforced permission matches the application gate
For every user-session table, the permission named by the database policy SHALL equal the permission
its application data-layer module requires, and a check SHALL fail when the two disagree.

#### Scenario: Drift between database and application
- **WHEN** a module is re-pinned to a different permission without changing the table policy, or the
  reverse
- **THEN** the consistency check fails and names the table

### Requirement: The model is provable and repeatable on a local database
An automated database test suite SHALL cover every platform role, a non-staff authenticated user and
`anon` against every table and operation of this capability, impersonating each session, and SHALL
fail when any result differs from the expected matrix. It SHALL run in a rolled-back transaction
against a local database only.

#### Scenario: Denials are asserted by their real mechanism
- **WHEN** a request is refused by a missing grant, by a policy filter, or allowed
- **THEN** the suite asserts a permission error for the first, zero affected rows with the targeted
  row proved intact for the second, and the returned value for an allowed write

#### Scenario: No code is fetched from the network
- **WHEN** the suite is installed or run
- **THEN** it uses only the database's own extensions and the repository's files

#### Scenario: A role is wider than intended
- **WHEN** a role is granted a permission the matrix does not expect for a table, or a policy admits
  more than it should
- **THEN** the suite exits non-zero and names the role, table and operation

#### Scenario: No side effects
- **WHEN** the suite passes, fails or aborts
- **THEN** no row, role assignment, policy or privilege is left changed

#### Scenario: Policy inventory
- **WHEN** a policy is added to or removed from a table of this capability without updating the
  expectations
- **THEN** the policy inventory test fails

### Requirement: Every user-session path keeps working for its permission
Every application path that reads or writes a table of this capability with a user session SHALL be
covered by a regression test that proves it works for a holder of its gating permission and returns
no data for a staff member without it.

#### Scenario: Silent zero-row failure is caught
- **WHEN** a user-session reader is gated in the application by a permission different from the one
  the table policy requires
- **THEN** the regression test for that path fails

### Requirement: The documented permission model is accurate
`src/lib/auth/dal.ts` and the migration notes SHALL describe the model as it is: the staff floor for
tables not covered, closed tables for service-only data, per-permission policies for the rest, and
the reason for each.

#### Scenario: A reader checks the model
- **WHEN** a developer reads the permission-model notes
- **THEN** they do not claim that no policy uses a fine-grained permission
